import { describe, expect, it } from "vitest";

import { actionOutputs, renderSummary } from "../src/reporting";
import { RunResult } from "../src/run-result";
import { zeroCounts } from "../src/sync-result";

describe("reporting", () => {
  it("derives the job summary and outputs from the same run result", () => {
    const result = new RunResult(
      [
        {
          repository: "matharts/example",
          status: "同步完成",
          counts: { ...zeroCounts(), created: 1, updated: 2, deleted: 1, unchanged: 3, preserved: 4 },
        },
        {
          repository: "matharts/failing",
          status: "失败",
          counts: zeroCounts(),
        },
      ],
      [{ repository: "matharts/failing", error: "bad | input\nsecond line" }],
    );

    const summary = renderSummary(result, {
      owner: "matharts",
      configFile: "labels.yml",
      policyFile: "policy.yml",
      dryRun: false,
    });

    expect(summary).toContain("`matharts/example`");
    expect(summary).toContain("bad \\| input second line");
    expect(summary).toContain("Dry Run：`false`");
    expect(actionOutputs(result)).toEqual({
      repositories: 2,
      changed: true,
      created: 1,
      updated: 2,
      renamed: 0,
      deleted: 1,
      unchanged: 3,
      preserved: 4,
      failures: 1,
    });
  });
});
