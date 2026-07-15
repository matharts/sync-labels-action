import type { RunSafetyViolation } from "./run-plan";
import { OperationCounts } from "./operation-counts";

export type RunMode = "preview" | "apply";

export interface RepositorySuccess {
  readonly kind: "success";
  readonly repository: string;
  readonly counts: OperationCounts;
}

export interface RepositoryFailure {
  readonly kind: "failure";
  readonly repository: string;
  readonly phase: "planning" | "safety" | "execution";
  readonly error: string;
  readonly counts: OperationCounts;
}

export type RepositoryOutcome = RepositorySuccess | RepositoryFailure;

export interface RunStatistics {
  readonly repositories: number;
  readonly counts: OperationCounts;
  readonly failures: number;
  readonly changed: boolean;
}

export class RunResult {
  readonly mode: RunMode;
  readonly outcomes: readonly RepositoryOutcome[];
  readonly safetyViolation: RunSafetyViolation | undefined;
  readonly failures: readonly RepositoryFailure[];
  readonly statistics: RunStatistics;

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
      outcomes.map((outcome) => {
        if (!(outcome.counts instanceof OperationCounts)) {
          throw new TypeError("运行结果只接受 OperationCounts。");
        }
        return Object.freeze({ ...outcome });
      }),
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
    this.failures = Object.freeze(
      this.outcomes.filter((outcome): outcome is RepositoryFailure => outcome.kind === "failure"),
    );
    const counts = OperationCounts.sum(this.outcomes.map((outcome) => outcome.counts));
    this.statistics = Object.freeze({
      repositories: this.outcomes.length,
      counts,
      failures: this.failures.length,
      changed: counts.changed,
    });
    Object.freeze(this);
  }
}
