import { describe, expect, it } from "vitest";

import { ActionReport } from "../src/action-report";
import { OperationCounts } from "../src/operation-counts";
import { RunResult } from "../src/run-result";

describe("ActionReport", () => {
  it("labels repositories by phase and derives failure completion from the same result", () => {
    const report = ActionReport.synchronization(
      new RunResult("apply", [
        {
          kind: "success",
          repository: "matharts/success",
          counts: new OperationCounts(),
        },
        {
          kind: "failure",
          repository: "matharts/planning",
          phase: "planning",
          error: "could not plan",
          counts: new OperationCounts(),
        },
        {
          kind: "failure",
          repository: "matharts/execution",
          phase: "execution",
          error: "could not apply",
          counts: new OperationCounts(),
        },
      ]),
      {
        owner: "matharts",
        configFile: "labels.yml",
        policyFile: "policy.yml",
      },
    );

    expect(report.publication?.summary).toContain("| `matharts/success` | 同步完成 |");
    expect(report.publication?.summary).toContain("| `matharts/planning` | 规划失败 |");
    expect(report.publication?.summary).toContain("| `matharts/execution` | 执行失败 |");
    expect(report.publication?.summary).toContain(
      "- `matharts/planning`（规划失败）：could not plan",
    );
    expect(report.publication?.summary).toContain(
      "- `matharts/execution`（执行失败）：could not apply",
    );
    expect(report.completion).toEqual({ status: "failure", message: "2 个仓库同步失败。" });
  });

  it("derives the summary and outputs from one synchronization result", () => {
    const report = ActionReport.synchronization(
      new RunResult("apply", [
        {
          kind: "success",
          repository: "matharts/example",
          counts: new OperationCounts({
            created: 1,
            updated: 2,
            deleted: 1,
            unchanged: 3,
            preserved: 4,
          }),
        },
        {
          kind: "failure",
          repository: "matharts/failing",
          phase: "execution",
          error: "bad | input\nsecond line",
          counts: new OperationCounts(),
        },
      ]),
      {
        owner: "matharts",
        configFile: "labels.yml",
        policyFile: "policy.yml",
      },
    );

    expect(report.publication?.summary).toContain("`matharts/example`");
    expect(report.publication?.summary).toContain("bad \\| input second line");
    expect(report.publication?.summary).toContain("Dry Run：`false`");
    expect(report.publication?.summary).toContain("- Changed：`true`（至少完成一项变更）");
    expect(report.publication?.summary).toContain("| 2 | 1 | 2 | 0 | 1 | 3 | 4 | 1 |");
    expect(report.publication?.outputs).toEqual({
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

  it("derives preview reporting from the run result even when every repository fails", () => {
    const report = ActionReport.synchronization(
      new RunResult("preview", [
        {
          kind: "failure",
          repository: "matharts/failing",
          phase: "planning",
          error: "unavailable",
          counts: new OperationCounts(),
        },
      ]),
      {
        owner: "matharts",
        configFile: "labels.yml",
        policyFile: "policy.yml",
      },
    );

    expect(report.publication?.summary).toContain("Dry Run：`true`");
  });

  it("creates deterministic validation reporting with zero synchronization outputs", () => {
    const report = ActionReport.validation({
      configFile: "labels.yml",
      policyFile: "policy.yml",
    });

    expect(report.publication?.summary).toContain("- GitHub API 请求：`0`");
    expect(report.publication?.outputs).toEqual({
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
    expect(report.completion).toEqual({ status: "success" });
  });

  it("keeps changed false when apply completes no mutation, including a first-write failure", () => {
    const report = ActionReport.synchronization(
      new RunResult("apply", [
        {
          kind: "failure",
          repository: "matharts/failing",
          phase: "execution",
          error: "first write failed",
          counts: new OperationCounts(),
        },
      ]),
      {
        owner: "matharts",
        configFile: "labels.yml",
        policyFile: "policy.yml",
      },
    );

    expect(report.publication?.outputs.changed).toBe(false);
    expect(report.publication?.summary).toContain("- Changed：`false`（至少完成一项变更）");
    expect(report.publication?.summary).toContain("| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |");
  });

  it("normalizes invocation failures and freezes every exposed result object", () => {
    const failure = ActionReport.failure(new Error("input failed"));
    const nonErrorFailure = ActionReport.failure("plain failure");
    const validation = ActionReport.validation({
      configFile: "labels.yml",
      policyFile: "policy.yml",
    });

    expect(failure.publication).toBeNull();
    expect(failure.completion).toEqual({ status: "failure", message: "input failed" });
    expect(nonErrorFailure.completion).toEqual({ status: "failure", message: "plain failure" });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure.completion)).toBe(true);
    expect(Object.isFrozen(validation.publication)).toBe(true);
    expect(Object.isFrozen(validation.publication?.outputs)).toBe(true);
  });
});
