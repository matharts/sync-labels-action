import type { RepositoryCatalogPort } from "./github-port";
import type { RepositoryMetadata, RepositoryTarget } from "./repository-types";

export interface RepositoryScopePolicy {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

type RepositoryScopeSelection =
  | { readonly kind: "all" }
  | { readonly kind: "named"; readonly names: readonly string[]; readonly allowlisted: boolean };

export class RepositoryScope {
  readonly #include: readonly string[] | undefined;
  readonly #exclude: ReadonlySet<string>;

  private constructor(include: readonly string[] | undefined, exclude: readonly string[]) {
    this.#include = include === undefined ? undefined : Object.freeze([...include]);
    this.#exclude = new Set(exclude.map(repositoryKey));
    Object.freeze(this);
  }

  static create(policy: RepositoryScopePolicy, context = "仓库策略"): RepositoryScope {
    const include = policy.include;
    const exclude = policy.exclude ?? [];

    if (include !== undefined && include.length === 0) {
      throw new Error(`${context}的 repositories.include 不能为空。`);
    }
    validateRepositoryNames(include ?? [], `${context}的 repositories.include`);
    validateRepositoryNames(exclude, `${context}的 repositories.exclude`);

    const excluded = new Set(exclude.map(repositoryKey));
    const overlap = (include ?? [])
      .filter((name) => excluded.has(repositoryKey(name)))
      .sort((left, right) => left.localeCompare(right));
    if (overlap.length > 0) {
      throw new Error(
        `${context}的 repositories.include 与 repositories.exclude 不能重叠：${overlap.join(", ")}`,
      );
    }

    return new RepositoryScope(include, exclude);
  }

  get allRepositories(): boolean {
    return this.#include === undefined;
  }

  async select(
    client: RepositoryCatalogPort,
    {
      owner,
      onlyRepository = "",
    }: {
      readonly owner: string;
      readonly onlyRepository?: string;
    },
  ): Promise<readonly RepositoryTarget[]> {
    const requestedName = normalizeRequestedRepository(owner, onlyRepository);
    const selection = this.#selection(owner, requestedName);

    if (selection.kind === "all") {
      const repositories = await client.listOrganizationRepositories(owner);
      return Object.freeze(
        repositories.flatMap((repository) => {
          const fullName = repositoryFullName(repository, owner);
          const name = fullName.slice(fullName.indexOf("/") + 1);
          return !this.#excludes(name) && unsupportedRepositoryStates(repository).length === 0
            ? [target(fullName)]
            : [];
        }),
      );
    }

    const repositories: RepositoryTarget[] = [];
    for (const name of selection.names) {
      const repository = await client.getRepository(owner, name);
      const fullName = repositoryFullName(repository, owner, name);
      const states = unsupportedRepositoryStates(repository);
      if (states.length > 0) {
        const scope = selection.allowlisted ? "Allowlist 仓库" : "仓库";
        throw new Error(
          `${scope} ${fullName} 处于不可同步状态：${states.join(", ")}。请更新策略或选择其他仓库。`,
        );
      }
      repositories.push(target(fullName));
    }
    return Object.freeze(repositories);
  }

  #selection(owner: string, requestedName: string): RepositoryScopeSelection {
    if (requestedName.length > 0 && this.#excludes(requestedName)) {
      throw new Error(`仓库 ${owner}/${requestedName} 已被 repositories.exclude 排除。`);
    }

    if (requestedName.length === 0) {
      return this.#include === undefined
        ? Object.freeze({ kind: "all" })
        : Object.freeze({ kind: "named", names: this.#include, allowlisted: true });
    }

    if (this.#include === undefined) {
      return Object.freeze({
        kind: "named",
        names: Object.freeze([requestedName]),
        allowlisted: false,
      });
    }

    const selected = this.#include.find((name) => equalIgnoreCase(name, requestedName));
    if (selected === undefined) {
      throw new Error(`仓库 ${owner}/${requestedName} 不在标签同步 Allowlist 中。`);
    }
    return Object.freeze({
      kind: "named",
      names: Object.freeze([selected]),
      allowlisted: true,
    });
  }

  #excludes(name: string): boolean {
    return this.#exclude.has(repositoryKey(name));
  }
}

function normalizeRequestedRepository(owner: string, rawValue: string): string {
  let value = rawValue;
  if (value.length === 0) return "";

  const separator = value.indexOf("/");
  if (separator >= 0) {
    const requestedOwner = value.slice(0, separator);
    const repository = value.slice(separator + 1);
    if (!equalIgnoreCase(requestedOwner, owner)) {
      throw new Error(`指定仓库不属于 ${owner} 组织：${value}`);
    }
    value = repository;
  }

  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`指定仓库名称无效：${JSON.stringify(value)}`);
  }
  return value;
}

function repositoryFullName(
  repository: RepositoryMetadata,
  owner: string,
  expectedName?: string,
): string {
  const fullName = repository.fullName;
  let matches: boolean;
  let expected: string;

  if (expectedName !== undefined) {
    expected = `${owner}/${expectedName}`;
    matches = equalIgnoreCase(fullName, expected);
  } else {
    expected = `${owner}/*`;
    const separator = fullName.indexOf("/");
    const repositoryOwner = separator >= 0 ? fullName.slice(0, separator) : "";
    const repositoryName = separator >= 0 ? fullName.slice(separator + 1) : "";
    matches = equalIgnoreCase(repositoryOwner, owner) && /^[A-Za-z0-9._-]+$/.test(repositoryName);
  }

  if (!matches) {
    throw new Error(`仓库解析不一致：期望 ${expected}，实际 ${JSON.stringify(fullName)}`);
  }
  return fullName;
}

function unsupportedRepositoryStates(repository: RepositoryMetadata): string[] {
  const states: string[] = [];
  if (repository.archived) states.push("archived");
  if (repository.disabled) states.push("disabled");
  if (repository.fork) states.push("fork");
  return states;
}

function target(fullName: string): RepositoryTarget {
  return Object.freeze({ fullName });
}

function validateRepositoryNames(names: readonly string[], context: string): void {
  const invalid = names.find((name) => !/^[A-Za-z0-9._-]+$/.test(name));
  if (invalid !== undefined) {
    throw new Error(`${context} 包含无效仓库名称：${invalid}`);
  }

  const keys = names.map(repositoryKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${context} 包含重复值。`);
  }
}

function repositoryKey(name: string): string {
  return name.toLowerCase();
}

function equalIgnoreCase(left: string, right: string): boolean {
  return repositoryKey(left) === repositoryKey(right);
}
