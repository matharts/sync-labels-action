import { describe, expect, it } from "vitest";

import { RunPlan } from "../src/run-plan";
import { SyncPlan } from "../src/sync-plan";

describe("RunPlan", () => {
  it.each([
    [null, "整次运行计划 entries 必须是数组。"],
    [
      [
        { kind: "planning-failure", repository: "matharts/example", error: "first" },
        { kind: "planning-failure", repository: "matharts/example", error: "second" },
      ],
      "整次运行计划包含重复仓库：matharts/example",
    ],
    [
      [{ kind: "planned", repository: "matharts/example", plan: {} }],
      "仓库 matharts/example 缺少已验证的 SyncPlan。",
    ],
    [[{ kind: "unknown", repository: "matharts/example" }], "整次运行计划包含未知 entry。"],
  ])("rejects an invalid run plan %#", (entries, message) => {
    expect(() => new RunPlan(entries as never)).toThrow(message);
  });

  it("blocks all planned deletions while excluding unaffected repositories", () => {
    const plan = new RunPlan([
      {
        kind: "planned",
        repository: "matharts/legacy",
        plan: new SyncPlan([{ action: "delete", name: "legacy", reason: "legacy_alias" }]),
      },
      {
        kind: "planned",
        repository: "matharts/unchanged",
        plan: new SyncPlan([{ action: "unchanged", name: "type: bug" }]),
      },
    ]);

    const violation = plan.safetyViolation({ deletions: "deny" });

    expect(violation).toEqual({
      rule: "deletions",
      message: "同步策略禁止删除，但整次运行计划包含 1 个删除操作。",
      plannedDeletions: 1,
      affectedRepositories: [{ repository: "matharts/legacy", deletions: 1 }],
    });
    expect(Object.isFrozen(violation)).toBe(true);
    expect(Object.isFrozen(violation?.affectedRepositories)).toBe(true);
  });

  it("allows deletion counts at the per-repository limit", () => {
    const plan = new RunPlan([
      {
        kind: "planned",
        repository: "matharts/example",
        plan: new SyncPlan([{ action: "delete", name: "legacy", reason: "legacy_alias" }]),
      },
    ]);

    expect(
      plan.safetyViolation({ deletions: "allow", maxDeletionsPerRepository: 1 }),
    ).toBeUndefined();
  });
});
