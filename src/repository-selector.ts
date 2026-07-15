import type { GitHubClientPort, Repository } from "./github-client";

export interface RepositorySelectionConfig {
  readonly repositoryNames: readonly string[] | undefined;
}

export class RepositorySelector {
  constructor(
    private readonly client: GitHubClientPort,
    private readonly config: RepositorySelectionConfig,
  ) {}

  async select({ owner, onlyRepository = "" }: { owner: string; onlyRepository?: string }): Promise<readonly Repository[]> {
    let names = this.config.repositoryNames;
    const requested = normalizeRequestedRepository(owner, onlyRepository);

    if (names === undefined && requested.length === 0) {
      const repositories = await this.client.listOrganizationRepositories(owner);
      return Object.freeze(
        repositories.filter((repository) => {
          repositoryFullName(repository, owner);
          return unsupportedRepositoryStates(repository).length === 0;
        }),
      );
    }

    if (requested.length > 0) {
      if (names === undefined) {
        return Object.freeze([await this.#loadNamedRepository(owner, requested, false)]);
      }
      const selected = names.find((name) => equalIgnoreCase(name, requested));
      if (selected === undefined) {
        throw new Error(`仓库 ${owner}/${requested} 不在标签同步 Allowlist 中。`);
      }
      names = [selected];
    }

    const repositories: Repository[] = [];
    for (const name of names ?? []) {
      repositories.push(await this.#loadNamedRepository(owner, name, true));
    }
    return Object.freeze(repositories);
  }

  async #loadNamedRepository(owner: string, name: string, allowlisted: boolean): Promise<Repository> {
    const repository = await this.client.getRepository(owner, name);
    const fullName = repositoryFullName(repository, owner, name);
    const states = unsupportedRepositoryStates(repository);
    if (states.length > 0) {
      const scope = allowlisted ? "Allowlist 仓库" : "仓库";
      throw new Error(`${scope} ${fullName} 处于不可同步状态：${states.join(", ")}。请更新策略或选择其他仓库。`);
    }
    return repository;
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

function repositoryFullName(repository: Repository, owner: string, expectedName?: string): string {
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

function unsupportedRepositoryStates(repository: Repository): string[] {
  const states: string[] = [];
  if (repository.archived) states.push("archived");
  if (repository.disabled) states.push("disabled");
  if (repository.fork) states.push("fork");
  return states;
}

function equalIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
