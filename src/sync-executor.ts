import type { GitHubClientPort } from "./github-client";
import type { SyncCounts } from "./sync-result";
import { RepositorySyncError, zeroCounts } from "./sync-result";
import { countFieldForAction, SyncPlan, type PlanEntry } from "./sync-plan";

type Output = (line: string) => void;
type MutableCounts = { -readonly [Key in keyof SyncCounts]: SyncCounts[Key] };

export class SyncExecutor {
  constructor(
    private readonly client: GitHubClientPort,
    private readonly dryRun: boolean,
    private readonly output: Output = console.log,
  ) {}

  async apply(fullName: string, plan: SyncPlan): Promise<SyncCounts> {
    if (!(plan instanceof SyncPlan)) {
      throw new TypeError("apply 需要已验证的 SyncPlan。");
    }

    const counts: MutableCounts = { ...zeroCounts() };
    try {
      for (const entry of plan.entries) {
        await this.#applyEntry(fullName, entry);
        counts[countFieldForAction(entry.action)] += 1;
      }
      return Object.freeze({ ...counts });
    } catch (error) {
      if (error instanceof RepositorySyncError) throw error;
      throw new RepositorySyncError(errorMessage(error), counts, { cause: error });
    }
  }

  async #applyEntry(fullName: string, entry: PlanEntry): Promise<void> {
    switch (entry.action) {
      case "create":
        this.output(`${this.#prefix("CREATE")}     ${entry.name}`);
        if (!this.dryRun) await this.client.createLabel(fullName, entry.desired);
        return;
      case "update":
      case "rename":
        this.output(`${this.#prefix(entry.action.toUpperCase())}     ${entry.name} -> ${entry.desired.name}`);
        if (!this.dryRun) await this.client.updateLabel(fullName, entry.name, entry.desired);
        return;
      case "delete": {
        const description = entry.reason === "legacy_alias"
          ? `legacy alias ${entry.name}`
          : `stale organization label ${entry.name}`;
        this.output(`${this.#prefix("DELETE")}     ${description}`);
        if (!this.dryRun) await this.client.deleteLabel(fullName, entry.name);
        return;
      }
      case "unchanged":
        this.output(`UNCHANGED       ${entry.name}`);
        return;
      case "preserve":
        this.output(`PRESERVE        repository label ${entry.name}`);
        return;
    }
  }

  #prefix(action: string): string {
    return this.dryRun ? `WOULD ${action}` : action;
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
