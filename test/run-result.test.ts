import { describe, expect, it } from "vitest";

import { OperationCounts } from "../src/operation-counts";
import { RunResult } from "../src/run-result";

describe("RunResult", () => {
  it("derives one immutable statistics value from successful and partial outcomes", () => {
    const result = new RunResult("apply", [
      {
        kind: "success",
        repository: "matharts/healthy",
        counts: new OperationCounts({ created: 1, unchanged: 2 }),
      },
      {
        kind: "failure",
        repository: "matharts/partial",
        phase: "execution",
        error: "second write failed",
        counts: new OperationCounts({ updated: 1 }),
      },
    ]);

    expect(result.statistics).toEqual({
      repositories: 2,
      counts: new OperationCounts({ created: 1, updated: 1, unchanged: 2 }),
      failures: 1,
      changed: true,
    });
    expect(result.failures.map(({ repository }) => repository)).toEqual(["matharts/partial"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.statistics)).toBe(true);
    expect(Object.isFrozen(result.failures)).toBe(true);
  });

  it("requires outcomes to carry validated operation counts", () => {
    expect(
      () =>
        new RunResult("apply", [
          {
            kind: "success",
            repository: "matharts/example",
            counts: {
              created: 0,
              updated: 0,
              renamed: 0,
              deleted: 0,
              unchanged: 0,
              preserved: 0,
            } as OperationCounts,
          },
        ]),
    ).toThrow("运行结果只接受 OperationCounts");
  });
});
