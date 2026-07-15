import type { RunResult } from "./run-result";
import { changed } from "./sync-result";

export interface SummaryContext {
  readonly owner: string;
  readonly configFile: string;
  readonly policyFile: string;
}

export interface ActionOutputs {
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

export function renderSummary(runResult: RunResult, context: SummaryContext): string {
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

export function actionOutputs(runResult: RunResult): ActionOutputs {
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
