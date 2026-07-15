import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
  exclude: [private]
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
    expect(config.safety).toEqual({
      deletions: "deny",
      maxDeletionsPerRepository: 2,
      maxDeletionsTotal: 3,
    });
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

  it("converts YAML binary and ordered-map values before Ruby-compatible coercion", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      `
- name: "type: binary"
  color: "D73A4A"
  description: !!binary YnVn
- name: "type: map"
  color: "D73A4A"
  description: !!omap
    - foo: bar
`,
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    const config = await GovernanceConfig.load({ labelsPath, policyPath });

    expect(config.labels.map(({ description }) => description)).toEqual(["bug", "[object Object]"]);
  });

  it("accepts a scalar alias through legacy array coercion", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n  aliases: bug\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: [bug]\n',
    );

    const config = await GovernanceConfig.load({ labelsPath, policyPath });

    expect(config.labels[0]?.aliases).toEqual(["bug"]);
  });

  it("preserves the v1.3 deletion behavior when safety is omitted", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    const config = await GovernanceConfig.load({ labelsPath, policyPath });

    expect(config.safety).toEqual({ deletions: "allow" });
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

  it("reports a missing configuration file with its source path", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );
    const missingLabelsPath = `${labelsPath}.missing`;

    await expect(
      GovernanceConfig.load({ labelsPath: missingLabelsPath, policyPath }),
    ).rejects.toThrow(`找不到标签配置文件：${missingLabelsPath}`);
  });

  it("preserves non-ENOENT filesystem errors", async () => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
    );

    await expect(
      GovernanceConfig.load({ labelsPath: dirname(labelsPath), policyPath }),
    ).rejects.toMatchObject({ code: "EISDIR" });
  });

  it.each([
    ["policy root", "[]\n", "YAML 根节点必须是对象"],
    [
      "version",
      'version: 2\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
      "version 必须是 1",
    ],
    ["managed", "version: 1\nmanaged: []\n", "managed 必须是对象"],
    [
      "repositories",
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories: []\n',
      "repositories 必须是对象",
    ],
    [
      "safety",
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nsafety: []\n',
      "safety 必须是对象",
    ],
    [
      "managed prefix",
      "version: 1\nmanaged:\n  prefixes: [type]\n  exact_names: []\n  legacy_names: []\n",
      "受管前缀必须以冒号结尾：type",
    ],
    [
      "managed name overlap",
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: [bug]\n  legacy_names: [BUG]\n',
      "exact_names 与 legacy_names 不能重叠：bug",
    ],
    [
      "deletion mode",
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nsafety:\n  deletions: prompt\n',
      "safety.deletions 必须是 allow 或 deny",
    ],
    [
      "deletion limit",
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nsafety:\n  max_deletions_total: -1\n',
      "safety.max_deletions_total 必须是非负整数",
    ],
    [
      "unknown root field",
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nunexpected: true\n',
      "包含未知根字段：unexpected",
    ],
    [
      "non-array prefixes",
      'version: 1\nmanaged:\n  prefixes: "type:"\n  exact_names: []\n  legacy_names: []\n',
      "prefixes 必须是数组",
    ],
    [
      "empty managed value",
      'version: 1\nmanaged:\n  prefixes: [""]\n  exact_names: []\n  legacy_names: []\n',
      "prefixes 不能包含空值",
    ],
    [
      "duplicate managed value",
      'version: 1\nmanaged:\n  prefixes: ["type:", "TYPE:"]\n  exact_names: []\n  legacy_names: []\n',
      "prefixes 包含重复值",
    ],
  ])("rejects invalid %s", async (_case, policy, message) => {
    const [labelsPath, policyPath] = await writeConfiguration(
      '- name: "type: bug"\n  color: "D73A4A"\n',
      policy,
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(message);
  });

  it.each([
    ["non-array root", "{}\n", "YAML 根节点必须是数组"],
    ["empty root", "[]\n", "不能为空"],
    ["scalar item", "- label\n", "第 1 项必须是对象"],
    [
      "duplicate names",
      '- name: "type: bug"\n  color: "D73A4A"\n- name: "TYPE: BUG"\n  color: "D73A4A"\n',
      "包含重复标签名称",
    ],
    [
      "alias matching a canonical name",
      '- name: "type: bug"\n  color: "D73A4A"\n  aliases: ["type: feature"]\n- name: "type: feature"\n  color: "A2EEEF"\n',
      'type: bug 的 alias "type: feature" 同时是正式标签名称',
    ],
    [
      "shared alias",
      '- name: "type: bug"\n  color: "D73A4A"\n  aliases: [legacy]\n- name: "type: feature"\n  color: "A2EEEF"\n  aliases: [LEGACY]\n',
      'alias "LEGACY" 同时映射到 type: bug 和 type: feature',
    ],
  ])("rejects invalid labels: %s", async (_case, labels, message) => {
    const [labelsPath, policyPath] = await writeConfiguration(
      labels,
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: [legacy]\n',
    );

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(message);
  });

  it.each([
    [
      "unmanaged canonical label",
      '- name: "custom"\n  color: "D73A4A"\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n',
      "标签配置包含不在组织受管范围内的正式标签：custom",
    ],
    [
      "canonical legacy name",
      '- name: "type: bug"\n  color: "D73A4A"\n',
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: ["type: bug"]\n',
      "策略 legacy_names 不能同时是正式标签：type: bug",
    ],
  ])("rejects policy ownership conflicts: %s", async (_case, labels, policy, message) => {
    const [labelsPath, policyPath] = await writeConfiguration(labels, policy);

    await expect(GovernanceConfig.load({ labelsPath, policyPath })).rejects.toThrow(message);
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

  it("accepts exclude-only policies and rejects include/exclude overlap", async () => {
    const labels = '- name: "type: bug"\n  color: "D73A4A"\n';
    const [labelsPath, policyPath] = await writeConfiguration(
      labels,
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  exclude: [private]\n',
    );

    await GovernanceConfig.load({ labelsPath, policyPath });

    const [, conflictingPolicyPath] = await writeConfiguration(
      labels,
      'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\nrepositories:\n  include: [Example]\n  exclude: [example]\n',
    );
    await expect(
      GovernanceConfig.load({ labelsPath, policyPath: conflictingPolicyPath }),
    ).rejects.toThrow("repositories.include 与 repositories.exclude 不能重叠：Example");
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

    expect(config.labels.length).toBeGreaterThan(20);
    expect(config.safety).toEqual({
      deletions: "allow",
      maxDeletionsPerRepository: 1,
      maxDeletionsTotal: 6,
    });
  });
});
