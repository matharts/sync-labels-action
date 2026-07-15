import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GitHubClient, type HttpRequest } from "../src/github-client";
import { GovernanceConfig } from "../src/governance-config";
import { labelKey } from "../src/label-identity";
import type { LabelDefinition, PlanningConfig } from "../src/label-types";
import { actionOutputs, renderSummary } from "../src/reporting";
import { RepositorySelector } from "../src/repository-selector";
import { RunResult } from "../src/run-result";
import { SyncExecutor } from "../src/sync-executor";
import { SyncPlan } from "../src/sync-plan";
import { SyncPlanner } from "../src/sync-planner";
import { RepositorySyncError, zeroCounts } from "../src/sync-result";
import rubyV13 from "./fixtures/ruby-v1.3-behavior.json";

const desired: readonly LabelDefinition[] = rubyV13.desired;
const config: PlanningConfig = {
  labels: desired,
  managed(name) {
    const key = labelKey(name);
    return key.startsWith("type:") || ["help wanted", "bug", "enhancement"].includes(key);
  },
};

function recordRequest(
  requests: HttpRequest[],
  request: HttpRequest,
): Promise<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}> {
  requests.push(request);
  return Promise.resolve({
    status: request.method === "DELETE" ? 204 : 200,
    headers: {},
    body: "",
  });
}

function serializedRequests(requests: readonly HttpRequest[]): readonly Record<string, unknown>[] {
  return requests.map((request) => {
    const url = new URL(request.url);
    const serialized: Record<string, unknown> = {
      method: request.method,
      path: `${url.pathname}${url.search}`,
    };
    if (request.body !== undefined) serialized.body = JSON.parse(request.body) as unknown;
    return serialized;
  });
}

describe("Ruby v1.3 behavior parity", () => {
  it("matches safe YAML 1.1 configuration semantics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-labels-parity-"));
    const labelsPath = join(directory, "labels.yml");
    const policyPath = join(directory, "policy.yml");
    const policy =
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n';

    try {
      await writeFile(policyPath, policy, "utf8");
      await writeFile(
        labelsPath,
        '- name: "type: bug"\n  color: "D73A4A"\n  description: yes\n',
        "utf8",
      );
      const loaded = await GovernanceConfig.load({ labelsPath, policyPath });
      expect(loaded.labels[0]?.description).toBe(
        rubyV13.configuration.yaml_1_1_boolean_description,
      );

      await writeFile(
        labelsPath,
        '- name: "type: bug"\n  color: "D73A4A"\n  description: 2020-01-01\n',
        "utf8",
      );
      await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(
        rubyV13.configuration.disallowed_date_class,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("matches allowlist repository selection and request order", async () => {
    const requests: HttpRequest[] = [];
    const client = new GitHubClient({
      token: "fixture-token",
      baseUrl: "https://api.example.test",
      requester: async (request) => {
        requests.push(request);
        const url = new URL(request.url);
        const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            full_name: `matharts/${name}`,
            archived: false,
            disabled: false,
            fork: false,
          }),
        };
      },
    });
    const selector = new RepositorySelector(client, {
      repositoryNames: rubyV13.repository_selection.allowlist,
    });

    const selected = await selector.select({ owner: "matharts" });

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(
      rubyV13.repository_selection.request_paths,
    );
    expect(selected.map(({ fullName }) => fullName)).toEqual(rubyV13.repository_selection.selected);
    await expect(
      selector.select({
        owner: "matharts",
        onlyRepository: "private-project",
      }),
    ).rejects.toThrow(rubyV13.repository_selection.outside_allowlist_error);
    expect(requests).toHaveLength(2);
  });

  it("matches 403, 429, 5xx, and network read retry behavior", async () => {
    for (const scenario of rubyV13.http_retries.responses) {
      let attempts = 0;
      const delays: number[] = [];
      const client = new GitHubClient({
        token: "fixture-token",
        baseUrl: "https://api.example.test",
        requester: async () => {
          attempts += 1;
          if (scenario.succeeds && attempts > 1) {
            return { status: 200, headers: {}, body: "[]" };
          }
          return {
            status: scenario.status,
            headers: scenario.headers as Readonly<Record<string, string>>,
            body: '{"message":"fixture failure"}',
          };
        },
        sleeper: async (delay) => {
          delays.push(delay);
        },
        warning: () => {},
        maxRetries: scenario.max_retries,
      });

      const operation = client.listLabels("matharts/example");
      if (scenario.succeeds) await expect(operation, scenario.name).resolves.toEqual([]);
      else await expect(operation, scenario.name).rejects.toThrow(`Status: ${scenario.status}`);
      expect(attempts, scenario.name).toBe(scenario.attempts);
      expect(delays, scenario.name).toEqual(scenario.delays);
    }

    const network = rubyV13.http_retries.network;
    let attempts = 0;
    const delays: number[] = [];
    const client = new GitHubClient({
      token: "fixture-token",
      baseUrl: "https://api.example.test",
      requester: async () => {
        attempts += 1;
        if (attempts === 1)
          throw Object.assign(new Error("fixture timeout"), { code: network.code });
        return { status: 200, headers: {}, body: "[]" };
      },
      sleeper: async (delay) => {
        delays.push(delay);
      },
      warning: () => {},
      maxRetries: network.max_retries,
    });

    await expect(client.listLabels("matharts/example")).resolves.toEqual([]);
    expect(attempts).toBe(network.attempts);
    expect(delays).toEqual(network.delays);
  });

  it("matches the captured plan, request order, output, and dry-run behavior", async () => {
    const plan = new SyncPlanner(config).plan(rubyV13.planner.existing);
    expect(plan.toJSON()).toEqual(rubyV13.planner.plan);

    const requests: HttpRequest[] = [];
    const output: string[] = [];
    const client = new GitHubClient({
      token: "fixture-token",
      baseUrl: "https://api.example.test",
      requester: (request) => recordRequest(requests, request),
    });
    const counts = await new SyncExecutor(client, false, (line) => output.push(line)).apply(
      "matharts/example",
      plan,
    );

    expect(counts).toEqual(rubyV13.execution.counts);
    expect(serializedRequests(requests)).toEqual(rubyV13.execution.requests);
    expect(output).toEqual(rubyV13.execution.output_lines);

    const dryRequests: HttpRequest[] = [];
    const dryOutput: string[] = [];
    const dryClient = new GitHubClient({
      token: "fixture-token",
      baseUrl: "https://api.example.test",
      requester: (request) => recordRequest(dryRequests, request),
    });
    const dryCounts = await new SyncExecutor(dryClient, true, (line) => dryOutput.push(line)).apply(
      "matharts/example",
      plan,
    );

    expect(dryCounts).toEqual(rubyV13.dry_run.counts);
    expect(serializedRequests(dryRequests)).toEqual(rubyV13.dry_run.requests);
    expect(dryOutput).toEqual(rubyV13.dry_run.output_lines);
  });

  it("matches partial mutation failure accounting", async () => {
    const requests: HttpRequest[] = [];
    let posts = 0;
    const client = new GitHubClient({
      token: "fixture-token",
      baseUrl: "https://api.example.test",
      requester: async (request) => {
        requests.push(request);
        if (request.method === "POST") posts += 1;
        if (posts === 2) throw new Error("second mutation failed");
        return { status: 200, headers: {}, body: "" };
      },
    });
    const plan = new SyncPlan([
      { action: "create", name: desired[0]!.name, desired: desired[0]! },
      { action: "create", name: desired[2]!.name, desired: desired[2]! },
    ]);
    const output: string[] = [];

    let failure: RepositorySyncError | undefined;
    try {
      await new SyncExecutor(client, false, (line) => output.push(line)).apply(
        "matharts/example",
        plan,
      );
    } catch (error) {
      if (error instanceof RepositorySyncError) failure = error;
      else throw error;
    }

    expect(failure?.message).toBe(rubyV13.partial_failure.error);
    expect(failure?.counts).toEqual(rubyV13.partial_failure.counts);
    expect(serializedRequests(requests)).toEqual(rubyV13.partial_failure.requests);
    expect(output).toEqual(rubyV13.partial_failure.output_lines);
  });

  it("matches summaries, outputs, Unicode normalization, and URL escaping", async () => {
    const result = new RunResult("apply", [
      {
        kind: "success",
        repository: "matharts/example",
        counts: { ...zeroCounts(), created: 1, updated: 2, deleted: 1, unchanged: 3, preserved: 4 },
      },
      {
        kind: "failure",
        repository: "matharts/failing",
        phase: "execution",
        error: "bad | input\nsecond line",
        counts: zeroCounts(),
      },
    ]);

    expect(
      renderSummary(result, {
        owner: "matharts",
        configFile: "labels.yml",
        policyFile: "policy.yml",
      }),
    ).toBe(rubyV13.reporting.summary);
    expect(actionOutputs(result)).toEqual(rubyV13.reporting.outputs);

    for (const [input, expected] of Object.entries(rubyV13.unicode.keys)) {
      expect(labelKey(input)).toBe(expected);
    }
    const pathRequests: HttpRequest[] = [];
    const pathClient = new GitHubClient({
      token: "fixture-token",
      baseUrl: "https://api.example.test",
      requester: (request) => recordRequest(pathRequests, request),
    });
    const [labelName, escapedLabelName] = Object.entries(rubyV13.unicode.escaped)[0]!;
    await pathClient.deleteLabel("math arts/同步~test", labelName);
    expect(new URL(pathRequests[0]!.url).pathname).toBe(
      `/repos/${rubyV13.unicode.repository_path}/labels/${escapedLabelName}`,
    );

    const unicodePlan = new SyncPlanner({
      labels: [{ name: "type: bug", color: "D73A4A", description: "", aliases: [] }],
      managed: (name) => labelKey(name).startsWith("type:"),
    }).plan([
      { name: "type:café", color: "FFFFFF", description: "" },
      { name: "type:cafg", color: "FFFFFF", description: "" },
      { name: "type:", color: "FFFFFF", description: "" },
      { name: "type:😀", color: "FFFFFF", description: "" },
    ]);
    expect(
      unicodePlan.entries.filter((entry) => entry.action === "delete").map(({ name }) => name),
    ).toEqual(rubyV13.unicode.stale_managed_order);
  });
});
