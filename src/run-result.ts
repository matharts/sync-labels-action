import type { SyncCounts } from "./sync-result";
import { zeroCounts } from "./sync-result";

export interface RepositorySuccess {
  readonly kind: "success";
  readonly repository: string;
  readonly mode: "preview" | "apply";
  readonly counts: SyncCounts;
}

export interface RepositoryFailure {
  readonly kind: "failure";
  readonly repository: string;
  readonly phase: "planning" | "safety" | "execution";
  readonly error: string;
  readonly counts: SyncCounts;
}

export type RepositoryOutcome = RepositorySuccess | RepositoryFailure;

export class RunResult {
  readonly outcomes: readonly RepositoryOutcome[];

  constructor(outcomes: readonly RepositoryOutcome[]) {
    this.outcomes = Object.freeze(outcomes.map((outcome) => Object.freeze({
      ...outcome,
      counts: Object.freeze({ ...outcome.counts }),
    })));
    Object.freeze(this);
  }

  get failures(): readonly RepositoryFailure[] {
    return Object.freeze(this.outcomes.filter((outcome): outcome is RepositoryFailure => outcome.kind === "failure"));
  }

  get success(): boolean {
    return this.failures.length === 0;
  }

  get totals(): SyncCounts {
    const totals = { ...zeroCounts() };
    for (const result of this.outcomes) {
      for (const field of Object.keys(totals) as (keyof SyncCounts)[]) {
        totals[field] += result.counts[field];
      }
    }
    return Object.freeze(totals);
  }
}
