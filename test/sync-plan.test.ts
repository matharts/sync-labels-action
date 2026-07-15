import { describe, expect, it } from "vitest";

import { SyncPlan, type PlanEntry } from "../src/sync-plan";

const invalidPlans: readonly (readonly [string, unknown, string])[] = [
  ["non-array entries", null, "同步计划 entries 必须是数组。"],
  ["non-object entry", [null], "同步计划 entry 类型无效。"],
  ["missing name", [{ action: "create", name: "" }], "同步计划操作缺少标签名称。"],
  [
    "delete target",
    [{ action: "delete", name: "legacy", reason: "legacy_alias", desired: {} }],
    "delete 操作不能包含目标标签。",
  ],
  [
    "delete reason",
    [{ action: "delete", name: "legacy", reason: "obsolete" }],
    'delete 操作的原因无效："obsolete"',
  ],
  [
    "unchanged reason",
    [{ action: "unchanged", name: "type: bug", reason: "legacy_alias" }],
    "unchanged 操作不能包含删除原因。",
  ],
  ["missing target", [{ action: "create", name: "type: bug" }], "create 操作缺少目标标签。"],
];

describe("SyncPlan", () => {
  it.each(invalidPlans)("rejects %s", (_case, entries, message) => {
    expect(() => new SyncPlan(entries as readonly PlanEntry[])).toThrow(message);
  });
});
