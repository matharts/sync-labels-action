import type { GitHubClientPort } from "./github-client";
import type { PlanningConfig } from "./label-types";
import { RepositorySyncError, zeroCounts, type SyncCounts } from "./sync-result";
import { SyncExecutor } from "./sync-executor";
import { SyncPlanner } from "./sync-planner";

export interface ActionLogger {
  info(message: string): void;
  error(message: string, title?: string): void;
  startGroup(name: string): void;
  endGroup(): void;
}

export interface RepositorySynchronizerPort {
  sync(fullName: string): Promise<SyncCounts>;
}

export class RepositorySynchronizer implements RepositorySynchronizerPort {
  readonly #planner: SyncPlanner;
  readonly #executor: SyncExecutor;

  constructor(
    private readonly client: GitHubClientPort,
    config: PlanningConfig,
    dryRun: boolean,
    private readonly logger: ActionLogger,
  ) {
    this.#planner = new SyncPlanner(config);
    this.#executor = new SyncExecutor(client, dryRun, (line) => logger.info(line));
  }

  async sync(fullName: string): Promise<SyncCounts> {
    this.logger.startGroup(fullName);
    try {
      const existing = await this.client.listLabels(fullName);
      const plan = this.#planner.plan(existing);
      return await this.#executor.apply(fullName, plan);
    } catch (error) {
      if (error instanceof RepositorySyncError) throw error;
      throw new RepositorySyncError(errorMessage(error), zeroCounts(), { cause: error });
    } finally {
      this.logger.endGroup();
    }
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
