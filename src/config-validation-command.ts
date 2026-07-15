import { resolve } from "node:path";

import { GovernanceConfig } from "./governance-config";

export interface ConfigValidationCommandIO {
  readonly cwd: string;
  info(message: string): void;
  error(message: string): void;
}

interface ConfigValidationArguments {
  readonly configFile: string;
  readonly policyFile: string;
  readonly help: boolean;
}

const USAGE = `用法：pnpm validate:config [选项]

选项：
  --config-file <路径>  标签配置路径（默认 .github/labels.yml）
  --policy-file <路径>  同步策略路径（默认 .github/label-policy.yml）
  --help                显示帮助
`;

export async function runConfigValidationCommand(
  arguments_: readonly string[],
  io: ConfigValidationCommandIO,
): Promise<number> {
  try {
    const options = parseArguments(arguments_);
    if (options.help) {
      io.info(USAGE);
      return 0;
    }

    const labelsPath = resolve(io.cwd, options.configFile);
    const policyPath = resolve(io.cwd, options.policyFile);
    const config = await GovernanceConfig.load({ labelsPath, policyPath });
    io.info(`配置校验通过：${config.labels.length} 个标签。`);
    io.info(`标签配置：${labelsPath}`);
    io.info(`同步策略：${policyPath}`);
    return 0;
  } catch (error) {
    io.error(`配置校验失败：${errorMessage(error)}`);
    return 1;
  }
}

function parseArguments(arguments_: readonly string[]): ConfigValidationArguments {
  let configFile = ".github/labels.yml";
  let policyFile = ".github/label-policy.yml";
  let help = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--":
        break;
      case "--config-file":
        configFile = optionValue(arguments_, ++index, argument);
        break;
      case "--policy-file":
        policyFile = optionValue(arguments_, ++index, argument);
        break;
      case "--help":
        help = true;
        break;
      default:
        throw new Error(`未知参数：${argument}`);
    }
  }

  return Object.freeze({ configFile, policyFile, help });
}

function optionValue(arguments_: readonly string[], index: number, option: string): string {
  const value = arguments_[index];
  if (value === undefined || value.startsWith("--") || value.length === 0) {
    throw new Error(`${option} 缺少路径。`);
  }
  return value;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
