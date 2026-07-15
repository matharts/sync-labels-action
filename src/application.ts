import type { Repository } from "./github-client";
import type { ActionLogger, RepositorySynchronizerPort } from "./repository-synchronizer";
import { RunResult, type RepositoryFailure, type RepositoryOutcome } from "./run-result";
import { RepositorySyncError, zeroCounts } from "./sync-result";

export class Application {
  constructor(
    private readonly repositories: readonly Repository[],
    private readonly synchronizer: RepositorySynchronizerPort,
    private readonly dryRun: boolean,
    private readonly logger: ActionLogger,
  ) {}

  async run(): Promise<RunResult> {
    const results: RepositoryOutcome[] = [];
    const failures: RepositoryFailure[] = [];

    for (const repository of this.repositories) {
      const fullName = repository.fullName;
      try {
        const counts = await this.synchronizer.sync(fullName);
        results.push({
          repository: fullName,
          status: this.dryRun ? "预览完成" : "同步完成",
          counts,
        });
      } catch (error) {
        const message = errorMessage(error);
        this.#reportFailure(fullName, message);
        results.push({
          repository: fullName,
          status: "失败",
          counts: error instanceof RepositorySyncError ? error.counts : zeroCounts(),
        });
        failures.push({ repository: fullName, error: message });
      }
    }

    return new RunResult(results, failures);
  }

  #reportFailure(fullName: string, message: string): void {
    const firstLine = message.split("\n", 1)[0] ?? "";
    this.logger.error(`${fullName}: ${firstLine}`, "标签同步失败");
    this.logger.info("");
    this.logger.info(`Repository: ${fullName}`);
    this.logger.info(message);
    this.logger.info("");
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
