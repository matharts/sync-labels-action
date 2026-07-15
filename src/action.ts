import { Application, type ActionLogger } from "./application";
import { GitHubClient } from "./github-client";
import type { GitHubPort } from "./github-port";
import { GovernanceConfig } from "./governance-config";
import {
  actionOutputs,
  renderSummary,
  renderValidationSummary,
  validationOutputs,
} from "./reporting";
import { RuntimeOptions } from "./runtime-options";

export interface ActionRuntime extends ActionLogger {
  getInput(name: string): string;
  setSecret(value: string): void;
  setOutput(name: string, value: unknown): void;
  writeSummary(markdown: string): Promise<void>;
  setFailed(message: string): void;
}

interface ActionDependencies {
  readonly createClient?: (options: {
    readonly token: string;
    readonly baseUrl: string;
  }) => GitHubPort;
}

export async function runAction(
  runtime: ActionRuntime,
  dependencies: ActionDependencies = {},
): Promise<void> {
  try {
    const options = RuntimeOptions.load({
      SYNC_LABELS_TOKEN: runtime.getInput("token"),
      SYNC_LABELS_OWNER: runtime.getInput("owner"),
      SYNC_LABELS_CONFIG_FILE: runtime.getInput("config_file"),
      SYNC_LABELS_POLICY_FILE: runtime.getInput("policy_file"),
      SYNC_LABELS_DRY_RUN: runtime.getInput("dry_run"),
      SYNC_LABELS_VALIDATE_ONLY: runtime.getInput("validate_only"),
      SYNC_LABELS_REPOSITORY: runtime.getInput("repository"),
      SYNC_LABELS_API_URL: runtime.getInput("api_url"),
    });
    const config = await GovernanceConfig.load({
      labelsPath: options.configFile,
      policyPath: options.policyFile,
    });

    if (options.mode === "validate") {
      runtime.info("Mode: validate only");
      runtime.info(`Config: ${options.configFile}`);
      runtime.info(`Policy: ${options.policyFile}`);
      runtime.info("配置校验通过，未访问 GitHub API。");
      await runtime.writeSummary(renderValidationSummary(options));
      setOutputs(runtime, validationOutputs());
      return;
    }

    runtime.setSecret(options.token);
    const client =
      dependencies.createClient?.({ token: options.token, baseUrl: options.apiUrl }) ??
      new GitHubClient({ token: options.token, baseUrl: options.apiUrl });
    const repositories = await config.repositoryScope.select(client, {
      owner: options.owner,
      onlyRepository: options.onlyRepository,
    });

    runtime.info(`Owner: ${options.owner}`);
    runtime.info(`Config: ${options.configFile}`);
    runtime.info(`Policy: ${options.policyFile}`);
    runtime.info(`Dry run: ${String(options.mode === "preview")}`);
    runtime.info(`Repositories: ${repositories.length}`);
    runtime.info("");

    const result = await new Application({
      client,
      config,
      dryRun: options.mode === "preview",
      logger: runtime,
    }).run(repositories);

    await runtime.writeSummary(
      renderSummary(result, {
        owner: options.owner,
        configFile: options.configFile,
        policyFile: options.policyFile,
      }),
    );
    setOutputs(runtime, actionOutputs(result));

    if (!result.success) {
      runtime.setFailed(`${result.failures.length} 个仓库同步失败。`);
      return;
    }
    runtime.info(result.mode === "preview" ? "Dry Run 完成。" : "标签同步完成。");
  } catch (error) {
    runtime.setFailed(errorMessage(error));
  }
}

function setOutputs(runtime: ActionRuntime, outputs: object): void {
  for (const [name, value] of Object.entries(outputs)) {
    runtime.setOutput(name, value);
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
