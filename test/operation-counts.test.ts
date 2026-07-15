import { describe, expect, it } from "vitest";

import { OperationCounts, type SyncOperation } from "../src/operation-counts";

describe("OperationCounts", () => {
  it("derives every count and changed from synchronization operations", () => {
    const counts = OperationCounts.fromOperations([
      "create",
      "update",
      "rename",
      "delete",
      "unchanged",
      "preserve",
      "create",
    ]);

    expect(counts.toJSON()).toEqual({
      created: 2,
      updated: 1,
      renamed: 1,
      deleted: 1,
      unchanged: 1,
      preserved: 1,
    });
    expect(counts.changed).toBe(true);
    expect(Object.isFrozen(counts)).toBe(true);
  });

  it("aggregates immutable counts while non-changing operations keep changed false", () => {
    const counts = OperationCounts.sum([
      OperationCounts.fromOperations(["unchanged"]),
      OperationCounts.fromOperations(["preserve", "preserve"]),
    ]);

    expect(counts).toEqual(new OperationCounts({ unchanged: 1, preserved: 2 }));
    expect(counts.changed).toBe(false);
  });

  it("rejects invalid count values and unknown operations", () => {
    expect(() => new OperationCounts(null as never)).toThrow("同步操作计数必须是对象");
    expect(() => new OperationCounts({ created: -1 })).toThrow("非负安全整数");
    expect(() => new OperationCounts({ updated: 0.5 })).toThrow("非负安全整数");
    expect(() => OperationCounts.sum([{} as OperationCounts])).toThrow("只能聚合同步操作计数");
    expect(() => OperationCounts.fromOperations(["archive" as SyncOperation])).toThrow(
      '未知同步操作："archive"',
    );
  });
});
