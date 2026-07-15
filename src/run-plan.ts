import { SyncPlan } from "./sync-plan";
import { OperationCounts } from "./operation-counts";

export type RunPlanEntry =
  | { readonly kind: "planned"; readonly repository: string; readonly plan: SyncPlan }
  | { readonly kind: "planning-failure"; readonly repository: string; readonly error: string };

export interface RunSafetyPolicy {
  readonly deletions: "allow" | "deny";
  readonly maxDeletionsPerRepository?: number;
  readonly maxDeletionsTotal?: number;
}

export type RunSafetyRule = "deletions" | "max_deletions_per_repository" | "max_deletions_total";

export interface RepositoryDeletionRisk {
  readonly repository: string;
  readonly deletions: number;
}

export interface RunSafetyViolation {
  readonly rule: RunSafetyRule;
  readonly message: string;
  readonly plannedDeletions: number;
  readonly affectedRepositories: readonly RepositoryDeletionRisk[];
}

export class RunPlan {
  readonly entries: readonly RunPlanEntry[];
  readonly totals: OperationCounts;

  constructor(entries: readonly RunPlanEntry[]) {
    if (!Array.isArray(entries)) {
      throw new TypeError("整次运行计划 entries 必须是数组。");
    }

    const repositories = new Set<string>();
    this.entries = Object.freeze(
      entries.map((entry) => {
        if (repositories.has(entry.repository)) {
          throw new TypeError(`整次运行计划包含重复仓库：${entry.repository}`);
        }
        repositories.add(entry.repository);

        if (entry.kind === "planned") {
          if (!(entry.plan instanceof SyncPlan)) {
            throw new TypeError(`仓库 ${entry.repository} 缺少已验证的 SyncPlan。`);
          }
          return Object.freeze({ ...entry });
        }
        if (entry.kind === "planning-failure") {
          return Object.freeze({ ...entry });
        }
        throw new TypeError("整次运行计划包含未知 entry。");
      }),
    );
    this.totals = OperationCounts.sum(
      this.entries.flatMap((entry) => (entry.kind === "planned" ? [entry.plan.counts] : [])),
    );
    Object.freeze(this);
  }

  safetyViolation(policy: RunSafetyPolicy): RunSafetyViolation | undefined {
    const planned = this.entries.filter((entry) => entry.kind === "planned");
    const total = this.totals.deleted;
    if (total === 0) return undefined;
    if (policy.deletions === "deny") {
      return violation(
        "deletions",
        `同步策略禁止删除，但整次运行计划包含 ${total} 个删除操作。`,
        total,
        planned,
      );
    }

    const perRepositoryLimit = policy.maxDeletionsPerRepository;
    if (perRepositoryLimit !== undefined) {
      const unsafe = planned.filter((entry) => entry.plan.counts.deleted > perRepositoryLimit);
      const firstUnsafe = unsafe[0];
      if (firstUnsafe !== undefined) {
        return violation(
          "max_deletions_per_repository",
          `仓库 ${firstUnsafe.repository} 的删除操作数 ${firstUnsafe.plan.counts.deleted} ` +
            `超过安全上限 ${perRepositoryLimit}。`,
          total,
          unsafe,
        );
      }
    }
    if (policy.maxDeletionsTotal !== undefined && total > policy.maxDeletionsTotal) {
      return violation(
        "max_deletions_total",
        `整次运行的总删除操作数 ${total} 超过安全上限 ${policy.maxDeletionsTotal}。`,
        total,
        planned,
      );
    }
    return undefined;
  }
}

function violation(
  rule: RunSafetyRule,
  message: string,
  plannedDeletions: number,
  entries: readonly Extract<RunPlanEntry, { readonly kind: "planned" }>[],
): RunSafetyViolation {
  const affectedRepositories = Object.freeze(
    entries.flatMap((entry) =>
      entry.plan.counts.deleted === 0
        ? []
        : [Object.freeze({ repository: entry.repository, deletions: entry.plan.counts.deleted })],
    ),
  );
  return Object.freeze({ rule, message, plannedDeletions, affectedRepositories });
}
