import type { SyncCounts } from "./sync-result";
import { zeroCounts } from "./sync-result";

export interface RepositoryOutcome {
  readonly repository: string;
  readonly status: string;
  readonly counts: SyncCounts;
}

export interface RepositoryFailure {
  readonly repository: string;
  readonly error: string;
}

export class RunResult {
  readonly results: readonly RepositoryOutcome[];
  readonly failures: readonly RepositoryFailure[];

  constructor(results: readonly RepositoryOutcome[], failures: readonly RepositoryFailure[]) {
    this.results = Object.freeze(results.map((result) => Object.freeze({ ...result, counts: Object.freeze({ ...result.counts }) })));
    this.failures = Object.freeze(failures.map((failure) => Object.freeze({ ...failure })));
    Object.freeze(this);
  }

  get success(): boolean {
    return this.failures.length === 0;
  }

  get totals(): SyncCounts {
    const totals = { ...zeroCounts() };
    for (const result of this.results) {
      for (const field of Object.keys(totals) as (keyof SyncCounts)[]) {
        totals[field] += result.counts[field];
      }
    }
    return Object.freeze(totals);
  }
}
