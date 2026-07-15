import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAction, type ActionRuntime } from "../src/action";
import type { GitHubPort } from "../src/github-port";
import type { ExistingLabel, LabelDefinition } from "../src/label-types";
import type { RepositoryMetadata } from "../src/repository-types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

class FakeClient implements GitHubPort {
  readonly mutations: string[] = [];

  constructor(private readonly failingCreate?: string) {}

  async listOrganizationRepositories(_owner: string): Promise<readonly RepositoryMetadata[]> {
    return [];
  }
  async getRepository(owner: string, name: string): Promise<RepositoryMetadata> {
    return { fullName: `${owner}/${name}`, archived: false, disabled: false, fork: false };
  }
  async listLabels(_fullName: string): Promise<readonly ExistingLabel[]> {
    return [];
  }
  async createLabel(_fullName: string, desired: LabelDefinition): Promise<void> {
    this.mutations.push(desired.name);
    if (desired.name === this.failingCreate) throw new Error("simulated mutation failure");
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

describe("runAction", () => {
  it("runs a complete dry-run through the action interface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-labels-action-"));
    temporaryDirectories.push(directory);
    const labelsPath = join(directory, "labels.yml");
    const policyPath = join(directory, "policy.yml");
    await writeFile(labelsPath, '- name: "type: bug"\n  color: "D73A4A"\n', "utf8");
    await writeFile(
      policyPath,
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  include: [example]\n',
      "utf8",
    );

    const inputs: Record<string, string> = {
      token: "test-token",
      owner: "matharts",
      config_file: labelsPath,
      policy_file: policyPath,
      dry_run: "true",
      repository: "",
      api_url: "https://api.github.com",
    };
    const outputs = new Map<string, unknown>();
    const summaries: string[] = [];
    const failures: string[] = [];
    const runtime: ActionRuntime = {
      getInput: (name) => inputs[name] ?? "",
      setSecret: () => {},
      setOutput: (name, value) => outputs.set(name, value),
      writeSummary: async (markdown) => {
        summaries.push(markdown);
      },
      setFailed: (message) => failures.push(message),
      info: () => {},
      error: () => {},
      startGroup: () => {},
      endGroup: () => {},
    };
    const client = new FakeClient();

    await runAction(runtime, { createClient: () => client });

    expect(failures).toEqual([]);
    expect(client.mutations).toEqual([]);
    expect(outputs.get("repositories")).toBe(1);
    expect(outputs.get("created")).toBe(1);
    expect(outputs.get("changed")).toBe(true);
    expect(summaries.join("\n")).toContain("matharts/example");
  });

  it("runs a real apply and reports only mutations completed before a failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-labels-action-"));
    temporaryDirectories.push(directory);
    const labelsPath = join(directory, "labels.yml");
    const policyPath = join(directory, "policy.yml");
    await writeFile(
      labelsPath,
      '- name: "type: bug"\n  color: "D73A4A"\n- name: "help wanted"\n  color: "008672"\n',
      "utf8",
    );
    await writeFile(
      policyPath,
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: ["help wanted"]\n  legacy_names: []\nrepositories:\n  include: [example]\n',
      "utf8",
    );

    const inputs: Record<string, string> = {
      token: "test-token",
      owner: "matharts",
      config_file: labelsPath,
      policy_file: policyPath,
      dry_run: "false",
      repository: "",
      api_url: "https://api.github.com",
    };
    const outputs = new Map<string, unknown>();
    const summaries: string[] = [];
    const failures: string[] = [];
    const runtime: ActionRuntime = {
      getInput: (name) => inputs[name] ?? "",
      setSecret: () => {},
      setOutput: (name, value) => outputs.set(name, value),
      writeSummary: async (markdown) => {
        summaries.push(markdown);
      },
      setFailed: (message) => failures.push(message),
      info: () => {},
      error: () => {},
      startGroup: () => {},
      endGroup: () => {},
    };
    const client = new FakeClient("help wanted");

    await runAction(runtime, { createClient: () => client });

    expect(client.mutations).toEqual(["type: bug", "help wanted"]);
    expect(outputs.get("created")).toBe(1);
    expect(outputs.get("failures")).toBe(1);
    expect(failures).toEqual(["1 个仓库同步失败。"]);
    expect(summaries.join("\n")).toContain("simulated mutation failure");
  });
});
