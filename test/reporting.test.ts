import { describe, expect, it } from "vitest";

import {
  actionOutputs,
  renderSummary,
  renderValidationSummary,
  validationOutputs,
} from "../src/reporting";
import { RunResult } from "../src/run-result";
import { zeroCounts } from "../src/sync-result";

describe("reporting", () => {
  it("labels successful and failed repositories by execution phase", () => {
    const result = new RunResult("apply", [
      {
        kind: "success",
        repository: "matharts/success",
        counts: zeroCounts(),
      },
      {
        kind: "failure",
        repository: "matharts/planning",
        phase: "planning",
        error: "could not plan",
        counts: zeroCounts(),
      },
      {
        kind: "failure",
        repository: "matharts/execution",
        phase: "execution",
        error: "could not apply",
        counts: zeroCounts(),
      },
    ]);

    const summary = renderSummary(result, {
      owner: "matharts",
      configFile: "labels.yml",
      policyFile: "policy.yml",
    });

    expect(summary).toContain("| `matharts/success` | 同步完成 |");
    expect(summary).toContain("| `matharts/planning` | 规划失败 |");
    expect(summary).toContain("| `matharts/execution` | 执行失败 |");
    expect(summary).toContain("- `matharts/planning`（规划失败）：could not plan");
    expect(summary).toContain("- `matharts/execution`（执行失败）：could not apply");
  });

  it("derives the job summary and outputs from the same run result", () => {
    const result = new RunResult("apply", [
      {
        kind: "success",
        repository: "matharts/example",
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
    });

    expect(summary).toContain("`matharts/example`");
    expect(summary).toContain("bad \\| input second line");
    expect(summary).toContain("Dry Run：`false`");
    expect(summary).toContain("- Changed：`true`（至少完成一项变更）");
    expect(summary).toContain("| 2 | 1 | 2 | 0 | 1 | 3 | 4 | 1 |");
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

  it("derives dry-run reporting from the run result even when every repository fails", () => {
    const result = new RunResult("preview", [
      {
        kind: "failure",
        repository: "matharts/failing",
        phase: "planning",
        error: "unavailable",
        counts: zeroCounts(),
      },
    ]);

    const summary = renderSummary(result, {
      owner: "matharts",
      configFile: "labels.yml",
      policyFile: "policy.yml",
    });

    expect(result.mode).toBe("preview");
    expect(summary).toContain("Dry Run：`true`");
  });

  it("renders deterministic validation reporting with zero synchronization outputs", () => {
    expect(
      renderValidationSummary({ configFile: "labels.yml", policyFile: "policy.yml" }),
    ).toContain("- GitHub API 请求：`0`");
    expect(validationOutputs()).toEqual({
      repositories: 0,
      changed: false,
      created: 0,
      updated: 0,
      renamed: 0,
      deleted: 0,
      unchanged: 0,
      preserved: 0,
      failures: 0,
    });
  });

  it("keeps changed false when apply completes no mutation, including a first-write failure", () => {
    const result = new RunResult("apply", [
      {
        kind: "failure",
        repository: "matharts/failing",
        phase: "execution",
        error: "first write failed",
        counts: zeroCounts(),
      },
    ]);

    const outputs = actionOutputs(result);
    const summary = renderSummary(result, {
      owner: "matharts",
      configFile: "labels.yml",
      policyFile: "policy.yml",
    });

    expect(outputs.changed).toBe(false);
    expect(summary).toContain("- Changed：`false`（至少完成一项变更）");
    expect(summary).toContain("| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |");
  });
});
