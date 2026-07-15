import { SyncPlan } from "./sync-plan";
import { sumCounts, type SyncCounts } from "./sync-result";

export type RunPlanEntry =
  | { readonly kind: "planned"; readonly repository: string; readonly plan: SyncPlan }
  | { readonly kind: "planning-failure"; readonly repository: string; readonly error: string };

export interface RunSafetyPolicy {
  readonly deletions: "allow" | "deny";
  readonly maxDeletionsPerRepository?: number;
  readonly maxDeletionsTotal?: number;
}

export class RunPlan {
  readonly entries: readonly RunPlanEntry[];
  readonly totals: SyncCounts;

  constructor(entries: readonly RunPlanEntry[]) {
    if (!Array.isArray(entries)) {
      throw new TypeError("整次运行计划 entries 必须是数组。");
    }

    const repositories = new Set<string>();
    this.entries = Object.freeze(entries.map((entry) => {
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
    }));
    this.totals = sumCounts(this.entries.flatMap((entry) =>
      entry.kind === "planned" ? [entry.plan.counts] : []
    ));
    Object.freeze(this);
  }

  safetyViolation(policy: RunSafetyPolicy): string | undefined {
    const planned = this.entries.filter((entry) => entry.kind === "planned");
    const total = this.totals.deleted;
    if (total === 0) return undefined;
    if (policy.deletions === "deny") {
      return `同步策略禁止删除，但整次运行计划包含 ${total} 个删除操作。`;
    }

    const perRepositoryLimit = policy.maxDeletionsPerRepository;
    if (perRepositoryLimit !== undefined) {
      const unsafe = planned.find((entry) => entry.plan.counts.deleted > perRepositoryLimit);
      if (unsafe !== undefined) {
        return `仓库 ${unsafe.repository} 的删除操作数 ${unsafe.plan.counts.deleted} ` +
          `超过安全上限 ${perRepositoryLimit}。`;
      }
    }
    if (policy.maxDeletionsTotal !== undefined && total > policy.maxDeletionsTotal) {
      return `整次运行的总删除操作数 ${total} 超过安全上限 ${policy.maxDeletionsTotal}。`;
    }
    return undefined;
  }
}
