import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAction, type ActionRuntime } from "../src/action";
import { GitHubClient } from "../src/github-client";
import type { GitHubPort } from "../src/github-port";
import type { ExistingLabel, LabelDefinition } from "../src/label-types";
import type { RepositoryMetadata } from "../src/repository-types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

interface FakeClientOptions {
  readonly failingCreate?: string;
  readonly failingList?: string;
  readonly labels?: (fullName: string) => readonly ExistingLabel[];
}

class FakeClient implements GitHubPort {
  readonly mutations: string[] = [];

  constructor(private readonly options: FakeClientOptions = {}) {}

  async listOrganizationRepositories(_owner: string): Promise<readonly RepositoryMetadata[]> {
    return [];
  }
  async getRepository(owner: string, name: string): Promise<RepositoryMetadata> {
    return { fullName: `${owner}/${name}`, archived: false, disabled: false, fork: false };
  }
  async listLabels(fullName: string): Promise<readonly ExistingLabel[]> {
    if (fullName === this.options.failingList) throw new Error("simulated planning failure");
    return this.options.labels?.(fullName) ?? [];
  }
  async createLabel(_fullName: string, desired: LabelDefinition): Promise<void> {
    this.mutations.push(desired.name);
    if (desired.name === this.options.failingCreate) {
      throw new Error("simulated mutation failure");
    }
  }
  async updateLabel(
    _fullName: string,
    _currentName: string,
    desired: LabelDefinition,
  ): Promise<void> {
    this.mutations.push(desired.name);
  }
  async deleteLabel(_fullName: string, name: string): Promise<void> {
    this.mutations.push(name);
  }
}

interface ActionScenario {
  readonly labels: string;
  readonly policy: string;
  readonly dryRun: boolean;
  readonly client: GitHubPort;
}

async function runScenario({ labels, policy, dryRun, client }: ActionScenario) {
  const directory = await mkdtemp(join(tmpdir(), "sync-labels-action-"));
  temporaryDirectories.push(directory);
  const labelsPath = join(directory, "labels.yml");
  const policyPath = join(directory, "policy.yml");
  await writeFile(labelsPath, labels, "utf8");
  await writeFile(policyPath, policy, "utf8");

  const inputs: Record<string, string> = {
    token: "test-token",
    owner: "matharts",
    config_file: labelsPath,
    policy_file: policyPath,
    dry_run: String(dryRun),
    repository: "",
    api_url: "https://api.github.com",
  };
  const outputs = new Map<string, unknown>();
  const summaries: string[] = [];
  const failures: string[] = [];
  const logs: string[] = [];
  const runtime: ActionRuntime = {
    getInput: (name) => inputs[name] ?? "",
    setSecret: () => {},
    setOutput: (name, value) => outputs.set(name, value),
    writeSummary: async (markdown) => {
      summaries.push(markdown);
    },
    setFailed: (message) => failures.push(message),
    info: (message) => logs.push(message),
    error: (message) => logs.push(message),
    startGroup: () => {},
    endGroup: () => {},
  };

  await runAction(runtime, { createClient: () => client });

  return { outputs, summary: summaries.join("\n"), failures, logs };
}

const BUG_LABEL = '- name: "type: bug"\n  color: "D73A4A"\n';
const BUG_POLICY =
  'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  include: [example]\n';

describe("runAction", () => {
  it("reports deletion risk without changing execution outputs when safety blocks apply", async () => {
    const client = new FakeClient({
      labels: () => [
        { name: "type: bug", color: "D73A4A", description: null },
        { name: "type: obsolete", color: "FFFFFF", description: "stale" },
      ],
    });
    const result = await runScenario({
      labels: BUG_LABEL,
      policy:
        'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  include: [one, two]\nsafety:\n  deletions: allow\n  max_deletions_total: 1\n',
      dryRun: false,
      client,
    });

    expect(client.mutations).toEqual([]);
    expect(result.failures).toEqual(["2 个仓库同步失败。"]);
    expect(result.summary).toContain("| `matharts/one` | 安全阻止 |");
    expect(result.summary).toContain("| `matharts/two` | 安全阻止 |");
    expect(result.summary).toContain("## 删除安全");
    expect(result.summary).toContain("- 触发规则：`safety.max_deletions_total`");
    expect(result.summary).toContain("- 计划删除总量：`2`");
    expect(result.summary).toContain("| `matharts/one` | 1 |");
    expect(result.summary).toContain("| `matharts/two` | 1 |");
    expect(Object.fromEntries(result.outputs)).toEqual({
      repositories: 2,
      changed: false,
      created: 0,
      updated: 0,
      renamed: 0,
      deleted: 0,
      unchanged: 0,
      preserved: 0,
      failures: 2,
    });
  });

  it("reports only repositories that exceed the per-repository deletion limit", async () => {
    const desired = { name: "type: bug", color: "D73A4A", description: null };
    const stale = (name: string): ExistingLabel => ({
      name,
      color: "FFFFFF",
      description: "stale",
    });
    const client = new FakeClient({
      labels: (fullName) =>
        fullName.endsWith("one")
          ? [desired, stale("type: old-one"), stale("type: old-two")]
          : [desired, stale("type: old-one")],
    });
    const result = await runScenario({
      labels: BUG_LABEL,
      policy:
        'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  include: [one, two]\nsafety:\n  deletions: allow\n  max_deletions_per_repository: 1\n',
      dryRun: false,
      client,
    });

    expect(result.summary).toContain("- 触发规则：`safety.max_deletions_per_repository`");
    expect(result.summary).toContain("- 计划删除总量：`3`");
    expect(result.summary).toContain("| `matharts/one` | 2 |");
    expect(result.summary).not.toContain("| `matharts/two` | 1 |");
  });

  it("reports planning failures through the Action interface", async () => {
    const client = new FakeClient({ failingList: "matharts/failing" });
    const result = await runScenario({
      labels: BUG_LABEL,
      policy:
        'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  include: [failing, healthy]\n',
      dryRun: true,
      client,
    });

    expect(result.summary).toContain("| `matharts/failing` | 规划失败 |");
    expect(result.summary).toContain("| `matharts/healthy` | 预览完成 |");
    expect(result.summary).toContain("simulated planning failure");
    expect(Object.fromEntries(result.outputs)).toMatchObject({
      repositories: 2,
      changed: true,
      created: 1,
      failures: 1,
    });
  });

  it("keeps GitHub credentials redacted in action logs and summaries", async () => {
    const token = "secret-token";
    const client = new GitHubClient({
      token,
      baseUrl: "https://api.example.test",
      maxRetries: 0,
      requester: async (request) =>
        request.url.includes("/labels")
          ? {
              status: 403,
              headers: {},
              body: JSON.stringify({
                message: `Authorization: Bearer ${token}; echoed ${token}`,
              }),
            }
          : {
              status: 200,
              headers: {},
              body: JSON.stringify({
                full_name: "matharts/example",
                archived: false,
                disabled: false,
                fork: false,
              }),
            },
    });
    const result = await runScenario({
      labels: BUG_LABEL,
      policy: BUG_POLICY,
      dryRun: true,
      client,
    });

    const report = [result.summary, ...result.logs].join("\n");
    expect(report).toContain("Authorization: [REDACTED]; echoed [REDACTED]");
    expect(report).not.toContain(token);
  });

  it("runs a complete dry-run through the action interface", async () => {
    const client = new FakeClient();
    const result = await runScenario({
      labels: BUG_LABEL,
      policy: BUG_POLICY,
      dryRun: true,
      client,
    });

    expect(result.failures).toEqual([]);
    expect(client.mutations).toEqual([]);
    expect(result.outputs.get("repositories")).toBe(1);
    expect(result.outputs.get("created")).toBe(1);
    expect(result.outputs.get("changed")).toBe(true);
    expect(result.summary).toContain("matharts/example");
  });

  it("runs a real apply and reports only mutations completed before a failure", async () => {
    const client = new FakeClient({ failingCreate: "help wanted" });
    const result = await runScenario({
      labels: '- name: "type: bug"\n  color: "D73A4A"\n- name: "help wanted"\n  color: "008672"\n',
      policy:
        'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: ["help wanted"]\n  legacy_names: []\nrepositories:\n  include: [example]\n',
      dryRun: false,
      client,
    });

    expect(client.mutations).toEqual(["type: bug", "help wanted"]);
    expect(result.outputs.get("created")).toBe(1);
    expect(result.outputs.get("failures")).toBe(1);
    expect(result.failures).toEqual(["1 个仓库同步失败。"]);
    expect(result.summary).toContain("simulated mutation failure");
  });
});
