import type { LabelSyncPort } from "./github-port";
import type { PlanningConfig } from "./label-types";
import type { RepositoryTarget } from "./repository-types";
import { RunPlan, type RunPlanEntry, type RunSafetyPolicy } from "./run-plan";
import { RunResult, type RepositoryFailure, type RepositoryOutcome } from "./run-result";
import { RepositorySyncError, zeroCounts } from "./sync-result";
import { SyncExecutor } from "./sync-executor";
import { SyncPlanner } from "./sync-planner";

export interface ActionLogger {
  info(message: string): void;
  error(message: string, title?: string): void;
  startGroup(name: string): void;
  endGroup(): void;
}

interface ApplicationOptions {
  readonly client: LabelSyncPort;
  readonly config: PlanningConfig & { readonly safety?: RunSafetyPolicy };
  readonly dryRun: boolean;
  readonly logger: ActionLogger;
}

export class Application {
  readonly #client: LabelSyncPort;
  readonly #planner: SyncPlanner;
  readonly #executor: SyncExecutor;
  readonly #dryRun: boolean;
  readonly #logger: ActionLogger;
  readonly #safety: RunSafetyPolicy;

  constructor({ client, config, dryRun, logger }: ApplicationOptions) {
    this.#client = client;
    this.#planner = new SyncPlanner(config);
    this.#executor = new SyncExecutor(client, dryRun, (line) => logger.info(line));
    this.#dryRun = dryRun;
    this.#logger = logger;
    this.#safety = config.safety ?? { deletions: "allow" };
  }

  async run(repositories: readonly RepositoryTarget[]): Promise<RunResult> {
    const mode = this.#dryRun ? "preview" : "apply";
    const plan = await this.#plan(repositories);
    const outcomes: RepositoryOutcome[] = [];
    const safetyViolation = this.#dryRun ? undefined : plan.safetyViolation(this.#safety);
    if (safetyViolation !== undefined) {
      for (const entry of plan.entries) {
        const phase = entry.kind === "planning-failure" ? "planning" : "safety";
        const message = entry.kind === "planning-failure" ? entry.error : safetyViolation;
        this.#recordFailure(outcomes, entry.repository, phase, message, zeroCounts());
      }
      return new RunResult(mode, outcomes);
    }

    for (const entry of plan.entries) {
      const fullName = entry.repository;
      if (entry.kind === "planning-failure") {
        this.#recordFailure(outcomes, fullName, "planning", entry.error, zeroCounts());
        continue;
      }

      this.#logger.startGroup(fullName);
      try {
        const counts = await this.#executor.apply(fullName, entry.plan);
        outcomes.push({
          kind: "success",
          repository: fullName,
          counts,
        });
      } catch (error) {
        const message = errorMessage(error);
        const counts = error instanceof RepositorySyncError ? error.counts : zeroCounts();
        this.#recordFailure(outcomes, fullName, "execution", message, counts);
      } finally {
        this.#logger.endGroup();
      }
    }

    return new RunResult(mode, outcomes);
  }

  async #plan(repositories: readonly RepositoryTarget[]): Promise<RunPlan> {
    const entries: RunPlanEntry[] = [];
    for (const repository of repositories) {
      try {
        const existing = await this.#client.listLabels(repository.fullName);
        entries.push({
          kind: "planned",
          repository: repository.fullName,
          plan: this.#planner.plan(existing),
        });
      } catch (error) {
        entries.push({
          kind: "planning-failure",
          repository: repository.fullName,
          error: errorMessage(error),
        });
      }
    }
    return new RunPlan(entries);
  }

  #recordFailure(
    outcomes: RepositoryOutcome[],
    fullName: string,
    phase: RepositoryFailure["phase"],
    message: string,
    counts: ReturnType<typeof zeroCounts>,
  ): void {
    this.#reportFailure(fullName, message);
    outcomes.push({ kind: "failure", repository: fullName, phase, error: message, counts });
  }

  #reportFailure(fullName: string, message: string): void {
    const firstLine = message.split("\n", 1)[0] ?? "";
    this.#logger.error(`${fullName}: ${firstLine}`, "标签同步失败");
    this.#logger.info("");
    this.#logger.info(`Repository: ${fullName}`);
    this.#logger.info(message);
    this.#logger.info("");
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
