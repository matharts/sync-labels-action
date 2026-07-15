import { labelKey } from "./label-identity";
import type { ExistingLabel, LabelDefinition, PlanningConfig } from "./label-types";
import { SyncPlan, type PlanEntry } from "./sync-plan";

export class SyncPlanner {
  constructor(private readonly config: PlanningConfig) {}

  plan(existing: readonly ExistingLabel[]): SyncPlan {
    const entries: PlanEntry[] = [];
    const labelsByName = new Map(existing.map((label) => [labelKey(label.name), label]));
    const desiredKeys = new Set(this.config.labels.map((label) => labelKey(label.name)));

    for (const desired of this.config.labels) {
      const desiredKey = labelKey(desired.name);
      const current = labelsByName.get(desiredKey);
      const aliasMatches = uniqueLabels(
        desired.aliases
          .map((name) => labelsByName.get(labelKey(name)))
          .filter((label): label is ExistingLabel => label !== undefined),
      );

      if (current !== undefined) {
        if (labelChanged(current, desired)) {
          entries.push({ action: "update", name: current.name, desired });
        } else {
          entries.push({ action: "unchanged", name: current.name });
        }
        labelsByName.delete(labelKey(current.name));
        labelsByName.set(desiredKey, desired);

        for (const legacy of aliasMatches) {
          entries.push({ action: "delete", name: legacy.name, reason: "legacy_alias" });
          labelsByName.delete(labelKey(legacy.name));
        }
        continue;
      }

      if (aliasMatches.length > 1) {
        throw new Error(
          `多个旧标签同时映射到 ${desired.name}：${aliasMatches.map(({ name }) => name).join(", ")}`,
        );
      }

      const old = aliasMatches[0];
      if (old !== undefined) {
        entries.push({ action: "rename", name: old.name, desired });
        labelsByName.delete(labelKey(old.name));
        labelsByName.set(desiredKey, desired);
        continue;
      }

      entries.push({ action: "create", name: desired.name, desired });
      labelsByName.set(desiredKey, desired);
    }

    const remaining = [...labelsByName.values()].filter(
      (label) => !desiredKeys.has(labelKey(label.name)),
    );
    const staleManaged = remaining
      .filter((label) => this.config.managed(label.name))
      .sort(compareLabels);
    const repositorySpecific = remaining
      .filter((label) => !this.config.managed(label.name))
      .sort(compareLabels);

    for (const label of staleManaged) {
      entries.push({ action: "delete", name: label.name, reason: "stale_managed" });
    }
    for (const label of repositorySpecific) {
      entries.push({ action: "preserve", name: label.name });
    }

    return new SyncPlan(entries);
  }
}

function labelChanged(current: ExistingLabel, desired: LabelDefinition): boolean {
  return (
    current.name !== desired.name ||
    String(current.color).toUpperCase() !== desired.color ||
    String(current.description ?? "") !== desired.description
  );
}

function uniqueLabels(labels: readonly ExistingLabel[]): ExistingLabel[] {
  return [...new Map(labels.map((label) => [labelKey(label.name), label])).values()];
}

function compareLabels(left: ExistingLabel, right: ExistingLabel): number {
  return Buffer.compare(
    Buffer.from(left.name.toLowerCase(), "utf8"),
    Buffer.from(right.name.toLowerCase(), "utf8"),
  );
}
