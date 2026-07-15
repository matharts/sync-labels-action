import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GovernanceConfig } from "../src/governance-config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function writeConfiguration(labels: string, policy: string): Promise<[string, string]> {
  const directory = await mkdtemp(join(tmpdir(), "sync-labels-config-"));
  temporaryDirectories.push(directory);
  const labelsPath = join(directory, "labels.yml");
  const policyPath = join(directory, "policy.yml");
  await writeFile(labelsPath, labels, "utf8");
  await writeFile(policyPath, policy, "utf8");
  return [labelsPath, policyPath];
}

describe("GovernanceConfig", () => {
  it("loads, validates, normalizes, and freezes a self-contained configuration", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      `
- name: " type: bug "
  color: "#d73a4a"
  description: " bug "
  aliases: [" bug "]
- name: "help wanted"
  color: "008672"
`,
      `
version: 1
managed:
  prefixes: ["type:"]
  exact_names: ["help wanted"]
  legacy_names: [bug]
repositories:
  include: [example, docs]
safety:
  deletions: deny
  max_deletions_per_repository: 2
  max_deletions_total: 3
`,
    );

    const config = await GovernanceConfig.load({ labelsPath, policyPath });

    expect(config.labels).toEqual([
      { name: "type: bug", color: "D73A4A", description: "bug", aliases: ["bug"] },
      { name: "help wanted", color: "008672", description: "", aliases: [] },
    ]);
    expect(config.repositoryNames).toEqual(["example", "docs"]);
    expect(config.safety).toEqual({
      deletions: "deny",
      maxDeletionsPerRepository: 2,
      maxDeletionsTotal: 3,
    });
    expect(config.allRepositories).toBe(false);
    expect(config.managed("TYPE: obsolete")).toBe(true);
    expect(config.managed("custom")).toBe(false);
    expect(Object.isFrozen(config.labels)).toBe(true);
    expect(Object.isFrozen(config.labels[0]?.aliases)).toBe(true);
  });

  it("preserves the Ruby v1.3 YAML 1.1 scalar semantics", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n  description: yes\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    const config = await GovernanceConfig.load({ labelsPath, policyPath });

    expect(config.labels[0]?.description).toBe("true");
  });

  it("rejects YAML object types that Ruby safe_load did not permit", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n  description: 2020-01-01\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(
      "YAML 包含不允许的对象类型：Date",
    );
  });

  it("rejects unknown label fields", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n  extra: true\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(
      /未知字段：extra/,
    );
  });

  it("reports invalid YAML with the source path", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      "- name: [\n",
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(
      new RegExp(`标签配置文件 YAML 无效.*${labelsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });

  it("rejects aliases and empty repository includes that weaken governance", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n  aliases: [bug]\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  include: []\n',
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(
      "include 不能为空",
    );
  });

  it("requires every alias to remain organization-owned", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n  aliases: [bug]\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(
      "标签 aliases 必须同时登记到策略 legacy_names：bug",
    );
  });

  it("disables YAML aliases", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- &label\n  name: "type: bug"\n  color: "D73A4A"\n- *label\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(
      "Alias resolution is disabled",
    );
  });

  it("loads the repository's production governance configuration", async () => {
    const config = await GovernanceConfig.load({
      labelsPath: join(process.cwd(), ".github/labels.yml"),
      policyPath: join(process.cwd(), ".github/label-policy.yml"),
    });

    expect(config.allRepositories).toBe(true);
    expect(config.repositoryNames).toBeUndefined();
    expect(config.labels.length).toBeGreaterThan(20);
  });
});
