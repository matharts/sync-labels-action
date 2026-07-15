import type { RunSafetyViolation } from "./run-plan";
import { sumCounts, type SyncCounts } from "./sync-result";

export type RunMode = "preview" | "apply";

export interface RepositorySuccess {
  readonly kind: "success";
  readonly repository: string;
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
  readonly mode: RunMode;
  readonly outcomes: readonly RepositoryOutcome[];
  readonly safetyViolation: RunSafetyViolation | undefined;

  constructor(
    mode: RunMode,
    outcomes: readonly RepositoryOutcome[],
    safetyViolation?: RunSafetyViolation,
  ) {
    if (mode !== "preview" && mode !== "apply") {
      throw new TypeError(`运行模式无效：${JSON.stringify(mode)}`);
    }
    this.mode = mode;
    this.outcomes = Object.freeze(
      outcomes.map((outcome) =>
        Object.freeze({
          ...outcome,
          counts: Object.freeze({ ...outcome.counts }),
        }),
      ),
    );
    this.safetyViolation =
      safetyViolation === undefined
        ? undefined
        : Object.freeze({
            ...safetyViolation,
            affectedRepositories: Object.freeze(
              safetyViolation.affectedRepositories.map((repository) =>
                Object.freeze({ ...repository }),
              ),
            ),
          });
    Object.freeze(this);
  }

  get failures(): readonly RepositoryFailure[] {
    return Object.freeze(
      this.outcomes.filter((outcome): outcome is RepositoryFailure => outcome.kind === "failure"),
    );
  }

  get success(): boolean {
    return this.failures.length === 0;
  }

  get totals(): SyncCounts {
    return sumCounts(this.outcomes.map(({ counts }) => counts));
  }
}
