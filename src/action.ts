import { ActionReport } from "./action-report";
import { GitHubClient } from "./github-client";
import type { GitHubPort, LabelSyncPort } from "./github-port";
import { GovernanceConfig } from "./governance-config";
import { OperationCounts } from "./operation-counts";
import type { RepositoryTarget } from "./repository-types";
import { RunPlan, type RunPlanEntry } from "./run-plan";
import { RunResult, type RepositoryFailure, type RepositoryOutcome } from "./run-result";
import { RepositorySyncError, SyncExecutor } from "./sync-executor";
import { SyncPlanner } from "./sync-planner";

export interface ActionRuntime {
  getInput(name: string): string;
  setSecret(value: string): void;
  setOutput(name: string, value: unknown): void;
  writeSummary(markdown: string): Promise<void>;
  setFailed(message: string): void;
  info(message: string): void;
  error(message: string, title?: string): void;
  startGroup(name: string): void;
  endGroup(): void;
}

interface ActionAdapters {
  readonly createClient?: (options: {
    readonly token: string;
    readonly baseUrl: string;
  }) => GitHubPort;
}

interface ConfigurationPaths {
  readonly configFile: string;
  readonly policyFile: string;
}

interface ValidationOptions extends ConfigurationPaths {
  readonly mode: "validate";
}

interface SynchronizationOptions extends ConfigurationPaths {
  readonly mode: "preview" | "apply";
  readonly token: string;
  readonly owner: string;
  readonly onlyRepository: string;
  readonly apiUrl: string;
}

type ActionOptions = ValidationOptions | SynchronizationOptions;

interface InvocationOutcome {
  readonly report: ActionReport;
  readonly successMessage?: string;
}

export async function runAction(
  runtime: ActionRuntime,
  adapters: ActionAdapters = {},
): Promise<void> {
  await new ActionInvocation(runtime, adapters).run();
}

class ActionInvocation {
  constructor(
    private readonly runtime: ActionRuntime,
    private readonly adapters: ActionAdapters,
  ) {}

  async run(): Promise<void> {
    let outcome: InvocationOutcome;
    try {
      outcome = await this.#invoke();
    } catch (error) {
      outcome = { report: ActionReport.failure(error) };
    }

    if (!(await this.#publish(outcome.report))) return;
    if (outcome.successMessage !== undefined) this.runtime.info(outcome.successMessage);
  }

  async #invoke(): Promise<InvocationOutcome> {
    const options = loadOptions(this.runtime);
    const config = await GovernanceConfig.load({
      labelsPath: options.configFile,
      policyPath: options.policyFile,
    });

    if (options.mode === "validate") {
      this.runtime.info("Mode: validate only");
      this.runtime.info(`Config: ${options.configFile}`);
      this.runtime.info(`Policy: ${options.policyFile}`);
      this.runtime.info("配置校验通过，未访问 GitHub API。");
      return {
        report: ActionReport.validation({
          configFile: options.configFile,
          policyFile: options.policyFile,
        }),
      };
    }

    this.runtime.setSecret(options.token);
    const client =
      this.adapters.createClient?.({ token: options.token, baseUrl: options.apiUrl }) ??
      new GitHubClient({ token: options.token, baseUrl: options.apiUrl });
    const repositories = await config.repositoryScope.select(client, {
      owner: options.owner,
      onlyRepository: options.onlyRepository,
    });

    this.runtime.info(`Owner: ${options.owner}`);
    this.runtime.info(`Config: ${options.configFile}`);
    this.runtime.info(`Policy: ${options.policyFile}`);
    this.runtime.info(`Dry run: ${String(options.mode === "preview")}`);
    this.runtime.info(`Repositories: ${repositories.length}`);
    this.runtime.info("");

    const result = await this.#synchronize(
      client,
      config,
      repositories,
      options.mode === "preview",
    );
    const report = ActionReport.synchronization(result, {
      owner: options.owner,
      configFile: options.configFile,
      policyFile: options.policyFile,
    });
    return {
      report,
      ...(report.completion.status === "success"
        ? { successMessage: result.mode === "preview" ? "Dry Run 完成。" : "标签同步完成。" }
        : {}),
    };
  }

  async #synchronize(
    client: LabelSyncPort,
    config: GovernanceConfig,
    repositories: readonly RepositoryTarget[],
    dryRun: boolean,
  ): Promise<RunResult> {
    const mode = dryRun ? "preview" : "apply";
    const plan = await this.#plan(client, config, repositories);
    const outcomes: RepositoryOutcome[] = [];
    const safetyViolation = dryRun ? undefined : plan.safetyViolation(config.safety);
    if (safetyViolation !== undefined) {
      for (const entry of plan.entries) {
        const phase = entry.kind === "planning-failure" ? "planning" : "safety";
        const message = entry.kind === "planning-failure" ? entry.error : safetyViolation.message;
        this.#recordFailure(outcomes, entry.repository, phase, message, new OperationCounts());
      }
      return new RunResult(mode, outcomes, safetyViolation);
    }

    const executor = new SyncExecutor(client, dryRun, (line) => this.runtime.info(line));
    for (const entry of plan.entries) {
      const fullName = entry.repository;
      if (entry.kind === "planning-failure") {
        this.#recordFailure(outcomes, fullName, "planning", entry.error, new OperationCounts());
        continue;
      }

      this.runtime.startGroup(fullName);
      try {
        const counts = await executor.apply(fullName, entry.plan);
        outcomes.push({ kind: "success", repository: fullName, counts });
      } catch (error) {
        const message = errorMessage(error);
        const counts = error instanceof RepositorySyncError ? error.counts : new OperationCounts();
        this.#recordFailure(outcomes, fullName, "execution", message, counts);
      } finally {
        this.runtime.endGroup();
      }
    }

    return new RunResult(mode, outcomes);
  }

  async #plan(
    client: LabelSyncPort,
    config: GovernanceConfig,
    repositories: readonly RepositoryTarget[],
  ): Promise<RunPlan> {
    const planner = new SyncPlanner(config);
    const entries: RunPlanEntry[] = [];
    for (const repository of repositories) {
      try {
        const existing = await client.listLabels(repository.fullName);
        entries.push({
          kind: "planned",
          repository: repository.fullName,
          plan: planner.plan(existing),
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
    counts: OperationCounts,
  ): void {
    const firstLine = message.split("\n", 1)[0] ?? "";
    this.runtime.error(`${fullName}: ${firstLine}`, "标签同步失败");
    this.runtime.info("");
    this.runtime.info(`Repository: ${fullName}`);
    this.runtime.info(message);
    this.runtime.info("");
    outcomes.push({ kind: "failure", repository: fullName, phase, error: message, counts });
  }

  async #publish(report: ActionReport): Promise<boolean> {
    try {
      if (report.publication !== null) {
        await this.runtime.writeSummary(report.publication.summary);
        for (const [name, value] of Object.entries(report.publication.outputs)) {
          this.runtime.setOutput(name, value);
        }
      }
    } catch (error) {
      const publicationFailure = ActionReport.failure(error);
      if (publicationFailure.completion.status === "failure") {
        this.runtime.setFailed(publicationFailure.completion.message);
      }
      return false;
    }

    if (report.completion.status === "failure") {
      this.runtime.setFailed(report.completion.message);
    }
    return true;
  }
}

function loadOptions(runtime: ActionRuntime): ActionOptions {
  const environment: Readonly<Record<string, string | undefined>> = {
    SYNC_LABELS_TOKEN: runtime.getInput("token"),
    SYNC_LABELS_OWNER: runtime.getInput("owner"),
    SYNC_LABELS_CONFIG_FILE: runtime.getInput("config_file"),
    SYNC_LABELS_POLICY_FILE: runtime.getInput("policy_file"),
    SYNC_LABELS_DRY_RUN: runtime.getInput("dry_run"),
    SYNC_LABELS_VALIDATE_ONLY: runtime.getInput("validate_only"),
    SYNC_LABELS_REPOSITORY: runtime.getInput("repository"),
    SYNC_LABELS_API_URL: runtime.getInput("api_url"),
  };
  const validateOnly = parseBoolean(
    "SYNC_LABELS_VALIDATE_ONLY",
    environment.SYNC_LABELS_VALIDATE_ONLY ?? "false",
  );
  const paths = {
    configFile: environment.SYNC_LABELS_CONFIG_FILE ?? ".github/labels.yml",
    policyFile: environment.SYNC_LABELS_POLICY_FILE ?? ".github/label-policy.yml",
  };

  if (validateOnly) {
    return Object.freeze({ mode: "validate", ...paths });
  }

  const token = environment.SYNC_LABELS_TOKEN ?? "";
  const owner = (environment.SYNC_LABELS_OWNER ?? "").trim();
  if (token.trim().length === 0) {
    throw new Error("SYNC_LABELS_TOKEN 不能为空。");
  }
  if (owner.length === 0) {
    throw new Error("SYNC_LABELS_OWNER 不能为空。");
  }

  const dryRun = parseBoolean("SYNC_LABELS_DRY_RUN", environment.SYNC_LABELS_DRY_RUN ?? "true");
  return Object.freeze({
    mode: dryRun ? "preview" : "apply",
    token,
    owner,
    ...paths,
    onlyRepository: (environment.SYNC_LABELS_REPOSITORY ?? "").trim(),
    apiUrl: (environment.SYNC_LABELS_API_URL ?? "https://api.github.com").trim().replace(/\/$/, ""),
  });
}

function parseBoolean(name: string, value: string): boolean {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new TypeError(`${name} 必须是 true/false、1/0、yes/no 或 on/off。`);
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
