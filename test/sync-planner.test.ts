import { describe, expect, it } from "vitest";

import type { LabelDefinition, PlanningConfig } from "../src/label-types";
import { SyncPlan } from "../src/sync-plan";
import { SyncPlanner } from "../src/sync-planner";

const desired: readonly LabelDefinition[] = [
  {
    name: "type: bug",
    color: "D73A4A",
    description: "已有行为出现错误、缺陷或回归",
    aliases: ["bug"],
  },
  {
    name: "type: feature",
    color: "A2EEEF",
    description: "新增能力或改进现有功能",
    aliases: ["enhancement"],
  },
  {
    name: "help wanted",
    color: "008672",
    description: "维护者明确欢迎并能够评审外部贡献",
    aliases: [],
  },
];

const config: PlanningConfig = {
  labels: desired,
  managed(name) {
    const key = name.normalize("NFC").toLowerCase();
    return key.startsWith("type:") || ["help wanted", "bug", "enhancement"].includes(key);
  },
};

describe("SyncPlanner", () => {
  it("describes a complete repository change through an immutable plan", () => {
    const planner = new SyncPlanner(config);

    const plan = planner.plan([
      { name: "bug", color: "FFFFFF", description: "legacy" },
      { name: "type: feature", color: "A2EEEF", description: "新增能力或改进现有功能" },
      { name: "type: obsolete", color: "000000", description: "stale" },
      { name: "custom", color: "123456", description: "repository extension" },
    ]);

    expect(plan.entries.map(({ action }) => action)).toEqual([
      "rename",
      "unchanged",
      "create",
      "delete",
      "preserve",
    ]);
    expect(plan.entries.map(({ name }) => name)).toEqual([
      "bug",
      "type: feature",
      "help wanted",
      "type: obsolete",
      "custom",
    ]);
    expect(plan.counts).toEqual({
      created: 1,
      updated: 0,
      renamed: 1,
      deleted: 1,
      unchanged: 1,
      preserved: 1,
    });
    expect(plan.toJSON().entries[0]).toMatchObject({ action: "rename", name: "bug" });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.entries)).toBe(true);
  });

  it("rejects ambiguous aliases before returning a plan", () => {
    const ambiguous: PlanningConfig = {
      labels: [{ ...desired[1]!, aliases: ["enhancement", "feature"] }],
      managed: () => true,
    };

    expect(() =>
      new SyncPlanner(ambiguous).plan([
        { name: "enhancement", color: "FFFFFF", description: "legacy" },
        { name: "feature", color: "FFFFFF", description: "legacy" },
      ]),
    ).toThrow("多个旧标签同时映射到 type: feature");
  });

  it("deletes a legacy alias when the canonical label already exists", () => {
    const plan = new SyncPlanner(config).plan([
      { name: "type: bug", color: "D73A4A", description: "已有行为出现错误、缺陷或回归" },
      { name: "bug", color: "FFFFFF", description: "legacy duplicate" },
    ]);

    expect(plan.entries.slice(0, 2)).toEqual([
      { action: "unchanged", name: "type: bug" },
      { action: "delete", name: "bug", reason: "legacy_alias" },
    ]);
  });

  it("updates a canonical label whose metadata changed", () => {
    const plan = new SyncPlanner({ labels: [desired[0]!], managed: () => true }).plan([
      { name: "type: bug", color: "FFFFFF", description: "legacy" },
    ]);

    expect(plan.entries).toEqual([{ action: "update", name: "type: bug", desired: desired[0] }]);
  });

  it("copies and freezes caller-owned desired labels", () => {
    const mutable = {
      name: "type: bug",
      color: "D73A4A",
      description: "bug",
      aliases: ["bug"],
    };
    const plan = new SyncPlan([{ action: "create", name: mutable.name, desired: mutable }]);

    mutable.name = "changed";
    mutable.aliases.push("another");

    const entry = plan.entries[0];
    expect(entry?.action).toBe("create");
    if (entry?.action === "create") {
      expect(entry.desired.name).toBe("type: bug");
      expect(entry.desired.aliases).toEqual(["bug"]);
      expect(Object.isFrozen(entry.desired.aliases)).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan.toJSON());
  });

  it("rejects an unknown operation at the plan interface", () => {
    expect(() => new SyncPlan([{ action: "unknown", name: "later" } as never])).toThrow(
      "未知同步计划操作",
    );
  });

  it("rejects fields that do not belong to an operation", () => {
    expect(
      () => new SyncPlan([{ action: "preserve", name: "custom", desired: desired[0] } as never]),
    ).toThrow("preserve 操作不能包含目标标签");
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: desired[0]!.name,
            desired: desired[0],
            reason: "legacy_alias",
          } as never,
        ]),
    ).toThrow("create 操作不能包含删除原因");
  });

  it("rejects a desired label with a non-string name", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: 42, color: "D73A4A", description: "bug", aliases: [] },
          } as never,
        ]),
    ).toThrow("create 操作的目标标签 name 必须是字符串");
  });

  it("rejects a desired label with malformed aliases", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: "type: bug", color: "D73A4A", description: "bug", aliases: "bug" },
          } as never,
        ]),
    ).toThrow("create 操作的目标标签 aliases 必须是字符串数组");
  });

  it("rejects a desired label with a non-canonical color", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: "type: bug", color: "#d73a4a", description: "bug", aliases: [] },
          },
        ]),
    ).toThrow("create 操作的目标标签 color 必须是六位大写十六进制值");
  });

  it("rejects a desired label whose name exceeds GitHub's limit", () => {
    const name = "😀".repeat(51);
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name,
            desired: { name, color: "D73A4A", description: "bug", aliases: [] },
          },
        ]),
    ).toThrow("create 操作的目标标签 name 超过 50 个字符");
  });

  it("rejects an empty desired label name", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: "", color: "D73A4A", description: "bug", aliases: [] },
          },
        ]),
    ).toThrow("create 操作的目标标签 name 不能为空");
  });

  it("rejects whitespace-only desired label names", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "   ",
            desired: { name: "   ", color: "D73A4A", description: "bug", aliases: [] },
          },
        ]),
    ).toThrow("create 操作的目标标签 name 不能为空");
  });

  it("rejects a desired label description beyond GitHub's limit", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: {
              name: "type: bug",
              color: "D73A4A",
              description: "界".repeat(101),
              aliases: [],
            },
          },
        ]),
    ).toThrow("create 操作的目标标签 description 超过 100 个字符");
  });

  it("rejects empty desired label aliases", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: "type: bug", color: "D73A4A", description: "bug", aliases: [""] },
          },
        ]),
    ).toThrow("create 操作的目标标签 aliases 不能包含空值");
  });

  it("rejects whitespace-only desired label aliases", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: "type: bug", color: "D73A4A", description: "bug", aliases: ["   "] },
          },
        ]),
    ).toThrow("create 操作的目标标签 aliases 不能包含空值");
  });

  it("rejects non-canonical surrounding whitespace at the plan boundary", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: " type: bug", color: "D73A4A", description: "bug", aliases: [] },
          },
        ]),
    ).toThrow("create 操作的目标标签 name 不能包含首尾空白");
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: { name: "type: bug", color: "D73A4A", description: "bug", aliases: [" bug"] },
          },
        ]),
    ).toThrow("create 操作的目标标签 aliases 不能包含首尾空白");
  });

  it("rejects unknown desired label fields", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: {
              name: "type: bug",
              color: "D73A4A",
              description: "bug",
              aliases: [],
              unexpected: true,
            },
          } as never,
        ]),
    ).toThrow("create 操作的目标标签 包含未知字段：unexpected");
  });

  it("rejects duplicate desired label aliases after normalization", () => {
    expect(
      () =>
        new SyncPlan([
          {
            action: "create",
            name: "type: bug",
            desired: {
              name: "type: bug",
              color: "D73A4A",
              description: "bug",
              aliases: ["bug", "BUG"],
            },
          },
        ]),
    ).toThrow("create 操作的目标标签 aliases 包含重复值");
  });
});
