import type { RunResult } from "./run-result";
import { changed } from "./sync-result";

interface ActionOutputs {
  readonly repositories: number;
  readonly changed: boolean;
  readonly created: number;
  readonly updated: number;
  readonly renamed: number;
  readonly deleted: number;
  readonly unchanged: number;
  readonly preserved: number;
  readonly failures: number;
}

interface ActionPublication {
  readonly summary: string;
  readonly outputs: ActionOutputs;
}

type ActionCompletion =
  | { readonly status: "success" }
  | { readonly status: "failure"; readonly message: string };

export class ActionReport {
  readonly publication: ActionPublication | null;
  readonly completion: ActionCompletion;

  private constructor(publication: ActionPublication | null, completion: ActionCompletion) {
    this.publication =
      publication === null
        ? null
        : Object.freeze({
            summary: publication.summary,
            outputs: Object.freeze({ ...publication.outputs }),
          });
    this.completion = Object.freeze({ ...completion });
    Object.freeze(this);
  }

  static validation(context: {
    readonly configFile: string;
    readonly policyFile: string;
  }): ActionReport {
    return new ActionReport(
      {
        summary: renderValidationSummary(context),
        outputs: validationOutputs(),
      },
      { status: "success" },
    );
  }

  static synchronization(
    runResult: RunResult,
    context: {
      readonly owner: string;
      readonly configFile: string;
      readonly policyFile: string;
    },
  ): ActionReport {
    const outputs = synchronizationOutputs(runResult);
    return new ActionReport(
      {
        summary: renderSynchronizationSummary(runResult, context, outputs),
        outputs,
      },
      outputs.failures === 0
        ? { status: "success" }
        : { status: "failure", message: `${outputs.failures} 个仓库同步失败。` },
    );
  }

  static failure(cause: unknown): ActionReport {
    return new ActionReport(null, {
      status: "failure",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function renderSynchronizationSummary(
  runResult: RunResult,
  context: {
    readonly owner: string;
    readonly configFile: string;
    readonly policyFile: string;
  },
  outputs: ActionOutputs,
): string {
  const changedMeaning = runResult.mode === "preview" ? "完整计划包含变更" : "至少完成一项变更";
  const lines = [
    "# 标签同步结果",
    "",
    `- 组织：\`${context.owner}\``,
    `- 标签配置：\`${context.configFile}\``,
    `- 同步策略：\`${context.policyFile}\``,
    `- Dry Run：\`${String(runResult.mode === "preview")}\``,
    "- 模式：组织级受管标签",
    "",
    "| 仓库 | 状态 | 新建 | 更新 | 重命名 | 删除 | 未变化 | 保留扩展 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const result of runResult.outcomes) {
    const counts = result.counts;
    lines.push(
      `| \`${result.repository}\` | ${outcomeStatus(result, runResult.mode)} | ${counts.created} | ${counts.updated} | ` +
        `${counts.renamed} | ${counts.deleted} | ${counts.unchanged} | ${counts.preserved} |`,
    );
  }

  lines.push(
    "",
    "## 汇总",
    "",
    `- Changed：\`${String(outputs.changed)}\`（${changedMeaning}）`,
    "",
    "| 仓库 | 新建 | 更新 | 重命名 | 删除 | 未变化 | 保留扩展 | 失败 |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${outputs.repositories} | ${outputs.created} | ${outputs.updated} | ${outputs.renamed} | ${outputs.deleted} | ${outputs.unchanged} | ${outputs.preserved} | ${outputs.failures} |`,
  );

  const safetyViolation = runResult.safetyViolation;
  if (safetyViolation !== undefined) {
    lines.push(
      "",
      "## 删除安全",
      "",
      `- 触发规则：\`safety.${safetyViolation.rule}\``,
      `- 计划删除总量：\`${safetyViolation.plannedDeletions}\``,
      `- 阻止原因：${safetyViolation.message}`,
      "",
      "| 仓库 | 计划删除 |",
      "| --- | ---: |",
    );
    for (const repository of safetyViolation.affectedRepositories) {
      lines.push(`| \`${repository.repository}\` | ${repository.deletions} |`);
    }
  }

  if (runResult.failures.length > 0) {
    lines.push("", "## 失败", "");
    for (const failure of runResult.failures) {
      const message = failure.error.replace(/\n/g, " ").replace(/\|/g, "\\|");
      lines.push(
        `- \`${failure.repository}\`（${outcomeStatus(failure, runResult.mode)}）：${message}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderValidationSummary(context: {
  readonly configFile: string;
  readonly policyFile: string;
}): string {
  return [
    "# 配置校验结果",
    "",
    "- 状态：`通过`",
    `- 标签配置：\`${context.configFile}\``,
    `- 同步策略：\`${context.policyFile}\``,
    "- GitHub API 请求：`0`",
    "",
  ].join("\n");
}

function synchronizationOutputs(runResult: RunResult): ActionOutputs {
  const totals = runResult.totals;
  return {
    repositories: runResult.outcomes.length,
    changed: changed(totals),
    created: totals.created,
    updated: totals.updated,
    renamed: totals.renamed,
    deleted: totals.deleted,
    unchanged: totals.unchanged,
    preserved: totals.preserved,
    failures: runResult.failures.length,
  };
}

function validationOutputs(): ActionOutputs {
  return {
    repositories: 0,
    changed: false,
    created: 0,
    updated: 0,
    renamed: 0,
    deleted: 0,
    unchanged: 0,
    preserved: 0,
    failures: 0,
  };
}

function outcomeStatus(outcome: RunResult["outcomes"][number], mode: RunResult["mode"]): string {
  if (outcome.kind === "failure") {
    switch (outcome.phase) {
      case "planning":
        return "规划失败";
      case "safety":
        return "安全阻止";
      case "execution":
        return "执行失败";
    }
  }
  return mode === "preview" ? "预览完成" : "同步完成";
}
