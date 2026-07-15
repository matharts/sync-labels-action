import { readFile } from "node:fs/promises";

import { parseDocument } from "yaml";

import { validatedLabelDefinition } from "./label-definition";
import { labelKey } from "./label-identity";
import type { LabelDefinition, PlanningConfig } from "./label-types";
import type { RunSafetyPolicy } from "./run-plan";

interface GovernancePolicy {
  readonly prefixes: readonly string[];
  readonly exactNames: ReadonlySet<string>;
  readonly legacyNames: ReadonlySet<string>;
  readonly repositoryNames: readonly string[] | undefined;
  readonly safety: RunSafetyPolicy;
}

export class GovernanceConfig implements PlanningConfig {
  readonly labels: readonly LabelDefinition[];
  readonly repositoryNames: readonly string[] | undefined;
  readonly safety: RunSafetyPolicy;
  readonly #policy: GovernancePolicy;

  private constructor(labels: readonly LabelDefinition[], policy: GovernancePolicy) {
    this.labels = Object.freeze([...labels]);
    this.repositoryNames = policy.repositoryNames;
    this.safety = policy.safety;
    this.#policy = policy;
    Object.freeze(this);
  }

  static async load({
    labelsPath,
    policyPath,
  }: {
    labelsPath: string;
    policyPath: string;
  }): Promise<GovernanceConfig> {
    const labels = loadLabels(await loadYaml(labelsPath, "标签配置文件"), labelsPath);
    const policy = loadPolicy(await loadYaml(policyPath, "标签同步策略文件"), policyPath);
    validateLabelPolicy(labels, policy);
    return new GovernanceConfig(labels, policy);
  }

  get allRepositories(): boolean {
    return this.repositoryNames === undefined;
  }

  managed(name: string): boolean {
    return managedLabel(name, this.#policy);
  }
}

async function loadYaml(path: string, description: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`找不到${description}：${path}`, { cause: error });
    }
    throw error;
  }

  try {
    const document = parseDocument(source, {
      schema: "yaml-1.1",
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      prettyErrors: true,
    });
    if (document.errors.length > 0) {
      throw document.errors[0];
    }
    return convertSafeYamlValue(document.toJS({ maxAliasCount: 0 }));
  } catch (error) {
    throw new Error(`${description} YAML 无效（${path}）：${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function loadLabels(parsed: unknown, path: string): readonly LabelDefinition[] {
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} 的 YAML 根节点必须是数组。`);
  }
  if (parsed.length === 0) {
    throw new Error(`${path} 不能为空。`);
  }

  const allowedKeys = new Set(["name", "color", "description", "aliases"]);
  const labels = parsed.map((value, index): LabelDefinition => {
    if (!isRecord(value)) {
      throw new Error(`${path} 第 ${index + 1} 项必须是对象。`);
    }

    const unknownKeys = Object.keys(value)
      .filter((key) => !allowedKeys.has(key))
      .sort();
    if (unknownKeys.length > 0) {
      throw new Error(`${path} 第 ${index + 1} 项包含未知字段：${unknownKeys.join(", ")}`);
    }

    const name = rubyString(value.name).trim();
    const color = rubyString(value.color).replace(/^#/, "").toUpperCase();
    const description = rubyString(value.description).trim();
    const aliases = toArray(value.aliases).map((alias) => rubyString(alias).trim());

    return validatedLabelDefinition(
      { name, color, description, aliases },
      `${path} 第 ${index + 1} 项的标签 `,
    );
  });

  const desiredNames = labels.map(({ name }) => labelKey(name));
  if (new Set(desiredNames).size !== desiredNames.length) {
    throw new Error(`${path} 包含重复标签名称。`);
  }

  const desiredSet = new Set(desiredNames);
  const aliasOwners = new Map<string, string>();
  for (const label of labels) {
    for (const alias of label.aliases) {
      const aliasKey = labelKey(alias);
      if (desiredSet.has(aliasKey)) {
        throw new Error(`${label.name} 的 alias ${JSON.stringify(alias)} 同时是正式标签名称。`);
      }
      const owner = aliasOwners.get(aliasKey);
      if (owner !== undefined) {
        throw new Error(`alias ${JSON.stringify(alias)} 同时映射到 ${owner} 和 ${label.name}。`);
      }
      aliasOwners.set(aliasKey, label.name);
    }
  }

  return labels;
}

function loadPolicy(parsed: unknown, path: string): GovernancePolicy {
  if (!isRecord(parsed)) {
    throw new Error(`${path} 的 YAML 根节点必须是对象。`);
  }

  rejectUnknownKeys(
    parsed,
    new Set(["version", "managed", "repositories", "safety"]),
    `${path} 包含未知根字段`,
  );
  if (parsed.version !== 1) {
    throw new Error(`${path} 的 version 必须是 1。`);
  }
  if (!isRecord(parsed.managed)) {
    throw new Error(`${path} 的 managed 必须是对象。`);
  }
  const repositories = parsed.repositories ?? {};
  if (!isRecord(repositories)) {
    throw new Error(`${path} 的 repositories 必须是对象。`);
  }
  const safetyValue = parsed.safety ?? {};
  if (!isRecord(safetyValue)) {
    throw new Error(`${path} 的 safety 必须是对象。`);
  }

  rejectUnknownKeys(
    parsed.managed,
    new Set(["prefixes", "exact_names", "legacy_names"]),
    `${path} 的 managed 包含未知字段`,
  );
  rejectUnknownKeys(repositories, new Set(["include"]), `${path} 的 repositories 包含未知字段`);
  const safety = loadSafety(safetyValue, path);

  const prefixes = policyStringList(parsed.managed, "prefixes", path, false);
  const exactNames = policyStringList(parsed.managed, "exact_names", path, true);
  const legacyNames = policyStringList(parsed.managed, "legacy_names", path, true);
  const repositoryNames = Object.prototype.hasOwnProperty.call(repositories, "include")
    ? policyStringList(repositories, "include", path, false)
    : undefined;

  const invalidPrefix = prefixes.find((prefix) => !prefix.endsWith(":"));
  if (invalidPrefix !== undefined) {
    throw new Error(`${path} 的受管前缀必须以冒号结尾：${invalidPrefix}`);
  }
  const invalidRepository = repositoryNames?.find((name) => !/^[A-Za-z0-9._-]+$/.test(name));
  if (invalidRepository !== undefined) {
    throw new Error(`${path} 包含无效仓库名称：${invalidRepository}`);
  }

  const exactKeys = new Set(exactNames.map(labelKey));
  const legacyKeys = new Set(legacyNames.map(labelKey));
  const overlap = [...exactKeys].filter((key) => legacyKeys.has(key)).sort();
  if (overlap.length > 0) {
    throw new Error(`${path} 的 exact_names 与 legacy_names 不能重叠：${overlap.join(", ")}`);
  }

  return Object.freeze({
    prefixes: Object.freeze(prefixes.map(labelKey)),
    exactNames: exactKeys,
    legacyNames: legacyKeys,
    repositoryNames:
      repositoryNames === undefined ? undefined : Object.freeze([...repositoryNames]),
    safety,
  });
}

function loadSafety(value: Readonly<Record<string, unknown>>, path: string): RunSafetyPolicy {
  rejectUnknownKeys(
    value,
    new Set(["deletions", "max_deletions_per_repository", "max_deletions_total"]),
    `${path} 的 safety 包含未知字段`,
  );

  const deletions = value.deletions ?? "allow";
  if (deletions !== "allow" && deletions !== "deny") {
    throw new Error(`${path} 的 safety.deletions 必须是 allow 或 deny。`);
  }
  const perRepository = optionalNonnegativeInteger(
    value.max_deletions_per_repository,
    path,
    "max_deletions_per_repository",
  );
  const total = optionalNonnegativeInteger(value.max_deletions_total, path, "max_deletions_total");

  return Object.freeze({
    deletions,
    ...(perRepository === undefined ? {} : { maxDeletionsPerRepository: perRepository }),
    ...(total === undefined ? {} : { maxDeletionsTotal: total }),
  });
}

function optionalNonnegativeInteger(value: unknown, path: string, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} 的 safety.${key} 必须是非负整数。`);
  }
  return value as number;
}

function policyStringList(
  container: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  allowEmpty: boolean,
): string[] {
  const values = container[key];
  if (!Array.isArray(values)) {
    throw new Error(`${path} 的 ${key} 必须是数组。`);
  }
  const normalized = values.map((value) => rubyString(value).trim());
  if (normalized.some((value) => value.length === 0)) {
    throw new Error(`${path} 的 ${key} 不能包含空值。`);
  }
  if (!allowEmpty && normalized.length === 0) {
    throw new Error(`${path} 的 ${key} 不能为空。`);
  }
  const keys = normalized.map(labelKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${path} 的 ${key} 包含重复值。`);
  }
  return normalized;
}

function validateLabelPolicy(labels: readonly LabelDefinition[], policy: GovernancePolicy): void {
  const unmanaged = labels
    .filter(({ name }) => !desiredLabelManaged(name, policy))
    .map(({ name }) => name)
    .sort();
  if (unmanaged.length > 0) {
    throw new Error(`标签配置包含不在组织受管范围内的正式标签：${unmanaged.join(", ")}`);
  }

  const aliases = new Set(labels.flatMap(({ aliases: values }) => values.map(labelKey)));
  const missingLegacy = [...aliases].filter((alias) => !policy.legacyNames.has(alias)).sort();
  if (missingLegacy.length > 0) {
    throw new Error(`标签 aliases 必须同时登记到策略 legacy_names：${missingLegacy.join(", ")}`);
  }

  const desired = new Set(labels.map(({ name }) => labelKey(name)));
  const legacyConflicts = [...desired].filter((name) => policy.legacyNames.has(name)).sort();
  if (legacyConflicts.length > 0) {
    throw new Error(`策略 legacy_names 不能同时是正式标签：${legacyConflicts.join(", ")}`);
  }
}

function desiredLabelManaged(name: string, policy: GovernancePolicy): boolean {
  const key = labelKey(name);
  return policy.prefixes.some((prefix) => key.startsWith(prefix)) || policy.exactNames.has(key);
}

function managedLabel(name: string, policy: GovernancePolicy): boolean {
  return desiredLabelManaged(name, policy) || policy.legacyNames.has(labelKey(name));
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  prefix: string,
): void {
  const unknown = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort();
  if (unknown.length > 0) {
    throw new Error(`${prefix}：${unknown.join(", ")}`);
  }
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function rubyString(value: unknown): string {
  if (value === undefined || value === null) return "";
  // oxlint-disable-next-line typescript/no-base-to-string -- Preserve the legacy Ruby-compatible YAML coercion behavior.
  return String(value);
}

function convertSafeYamlValue(value: unknown): unknown {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (Array.isArray(value)) {
    return value.map(convertSafeYamlValue);
  }
  if (value instanceof Date || value instanceof Set) {
    throw new TypeError(`YAML 包含不允许的对象类型：${value.constructor.name}`);
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [rubyString(key), convertSafeYamlValue(item)]),
    );
  }
  if (
    isRecord(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, convertSafeYamlValue(item)]),
    );
  }
  const name = typeof value === "object" && value !== null ? value.constructor?.name : typeof value;
  throw new TypeError(`YAML 包含不允许的对象类型：${name ?? "unknown"}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  // oxlint-disable-next-line typescript/no-base-to-string -- Preserve diagnostic text for non-Error throws.
  return String(value);
}
