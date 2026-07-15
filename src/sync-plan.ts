import type { LabelDefinition } from "./label-types";
import { validatedLabelDefinition } from "./label-definition";
import { OperationCounts, type OperationCountValues } from "./operation-counts";

export type DeleteReason = "legacy_alias" | "stale_managed";

export type PlanEntry =
  | {
      readonly action: "create" | "update" | "rename";
      readonly name: string;
      readonly desired: LabelDefinition;
    }
  | { readonly action: "delete"; readonly name: string; readonly reason: DeleteReason }
  | { readonly action: "unchanged" | "preserve"; readonly name: string };

interface SerializedPlanEntry {
  readonly action: string;
  readonly name: string;
  readonly desired?: LabelDefinition;
  readonly reason?: string;
}

export class SyncPlan {
  readonly entries: readonly PlanEntry[];
  readonly counts: OperationCounts;

  constructor(entries: readonly PlanEntry[]) {
    if (!Array.isArray(entries)) {
      throw new TypeError("同步计划 entries 必须是数组。");
    }

    this.entries = Object.freeze(entries.map((entry) => validateAndCopy(entry)));
    this.counts = OperationCounts.fromOperations(this.entries.map((entry) => entry.action));
    Object.freeze(this);
  }

  toJSON(): {
    readonly entries: readonly SerializedPlanEntry[];
    readonly counts: OperationCountValues;
  } {
    return {
      entries: this.entries.map((entry) => ({ ...entry })),
      counts: this.counts.toJSON(),
    };
  }
}

function validateAndCopy(value: PlanEntry): PlanEntry {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("同步计划 entry 类型无效。");
  }

  const entry = value as PlanEntry;
  if (!["create", "update", "rename", "delete", "unchanged", "preserve"].includes(entry.action)) {
    throw new TypeError(
      `未知同步计划操作：${JSON.stringify((entry as { action?: unknown }).action)}`,
    );
  }
  if (typeof entry.name !== "string" || entry.name.length === 0) {
    throw new TypeError("同步计划操作缺少标签名称。");
  }

  switch (entry.action) {
    case "create":
    case "update":
    case "rename": {
      const desired = immutableLabel(entry.desired, entry.action);
      const reason = (entry as PlanEntry & { readonly reason?: unknown }).reason;
      if (reason !== undefined && reason !== null) {
        throw new TypeError(`${entry.action} 操作不能包含删除原因。`);
      }
      return Object.freeze({
        action: entry.action,
        name: entry.name,
        desired,
      });
    }
    case "delete": {
      const desired = (entry as PlanEntry & { readonly desired?: unknown }).desired;
      if (desired !== undefined && desired !== null) {
        throw new TypeError("delete 操作不能包含目标标签。");
      }
      if (entry.reason !== "legacy_alias" && entry.reason !== "stale_managed") {
        throw new TypeError(`delete 操作的原因无效：${JSON.stringify(entry.reason)}`);
      }
      return Object.freeze({ action: entry.action, name: entry.name, reason: entry.reason });
    }
    case "unchanged":
    case "preserve": {
      const extended = entry as PlanEntry & {
        readonly desired?: unknown;
        readonly reason?: unknown;
      };
      if (extended.desired !== undefined && extended.desired !== null) {
        throw new TypeError(`${entry.action} 操作不能包含目标标签。`);
      }
      if (extended.reason !== undefined && extended.reason !== null) {
        throw new TypeError(`${entry.action} 操作不能包含删除原因。`);
      }
      return Object.freeze({ action: entry.action, name: entry.name });
    }
  }
}

function immutableLabel(
  value: LabelDefinition,
  action: "create" | "update" | "rename",
): LabelDefinition {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${action} 操作缺少目标标签。`);
  }
  return validatedLabelDefinition(value, `${action} 操作的目标标签 `);
}
