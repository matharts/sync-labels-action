import { describe, expect, it } from "vitest";

import { actionOutputs, renderSummary } from "../src/reporting";
import { RunResult } from "../src/run-result";
import { zeroCounts } from "../src/sync-result";

describe("reporting", () => {
  it("derives the job summary and outputs from the same run result", () => {
    const result = new RunResult([
      {
        kind: "success",
        repository: "matharts/example",
        mode: "apply",
        counts: { ...zeroCounts(), created: 1, updated: 2, deleted: 1, unchanged: 3, preserved: 4 },
      },
      {
        kind: "failure",
        repository: "matharts/failing",
        phase: "execution",
        error: "bad | input\nsecond line",
        counts: zeroCounts(),
      },
    ]);

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
