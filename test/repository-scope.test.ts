import { describe, expect, it } from "vitest";

import type { RepositoryCatalogPort } from "../src/github-port";
import { RepositoryScope, type RepositoryScopePolicy } from "../src/repository-scope";
import type { RepositoryMetadata } from "../src/repository-types";

class FakeClient implements RepositoryCatalogPort {
  readonly calls: string[] = [];

  constructor(
    private readonly repositories: Readonly<Record<string, RepositoryMetadata>>,
    private readonly organizationRepositories: readonly RepositoryMetadata[] = [],
  ) {}

  async listOrganizationRepositories(owner: string): Promise<readonly RepositoryMetadata[]> {
    this.calls.push(`list:${owner}`);
    return this.organizationRepositories;
  }

  async getRepository(owner: string, name: string): Promise<RepositoryMetadata> {
    this.calls.push(`get:${owner}/${name}`);
    const repository = this.repositories[`${owner}/${name}`];
    if (repository === undefined) throw new Error("missing repository fixture");
    return repository;
  }
}

function repository(
  fullName: string,
  overrides: Partial<RepositoryMetadata> = {},
): RepositoryMetadata {
  return { fullName, archived: false, disabled: false, fork: false, ...overrides };
}

function scope(policy: RepositoryScopePolicy = {}): RepositoryScope {
  return RepositoryScope.create(policy, "测试策略");
}

describe("RepositoryScope", () => {
  it("loads only allowlisted repositories in policy order", async () => {
    const client = new FakeClient({
      "matharts/example": repository("matharts/example"),
      "matharts/docs": repository("matharts/docs"),
    });
    const repositoryScope = scope({ include: ["example", "docs"] });

    const repositories = await repositoryScope.select(client, {
      owner: "matharts",
      onlyRepository: "",
    });

    expect(repositories.map(({ fullName }) => fullName)).toEqual([
      "matharts/example",
      "matharts/docs",
    ]);
    expect(client.calls).toEqual(["get:matharts/example", "get:matharts/docs"]);
  });

  it("filters unsupported repositories only in all-repositories mode", async () => {
    const client = new FakeClient({}, [
      repository("matharts/active"),
      repository("matharts/archived", { archived: true }),
      repository("matharts/disabled", { disabled: true }),
      repository("matharts/fork", { fork: true }),
    ]);
    const repositoryScope = scope();

    const repositories = await repositoryScope.select(client, { owner: "matharts" });

    expect(repositories.map(({ fullName }) => fullName)).toEqual(["matharts/active"]);
    expect(client.calls).toEqual(["list:matharts"]);
  });

  it("rejects a requested repository outside the allowlist before API access", async () => {
    const client = new FakeClient({});
    const repositoryScope = scope({ include: ["example"] });

    await expect(
      repositoryScope.select(client, { owner: "matharts", onlyRepository: "private" }),
    ).rejects.toThrow("不在标签同步 Allowlist");
    expect(client.calls).toEqual([]);
  });

  it("accepts owner/name when selecting one repository without an allowlist", async () => {
    const client = new FakeClient({ "matharts/example": repository("matharts/example") });
    const repositoryScope = scope();

    const repositories = await repositoryScope.select(client, {
      owner: "matharts",
      onlyRepository: "matharts/example",
    });

    expect(repositories.map(({ fullName }) => fullName)).toEqual(["matharts/example"]);
    expect(client.calls).toEqual(["get:matharts/example"]);
  });

  it("fails when an explicitly allowlisted repository is archived", async () => {
    const client = new FakeClient({
      "matharts/example": repository("matharts/example", { archived: true }),
    });
    const repositoryScope = scope({ include: ["example"] });

    await expect(repositoryScope.select(client, { owner: "matharts" })).rejects.toThrow(
      "Allowlist 仓库 matharts/example 处于不可同步状态：archived",
    );
  });

  it("applies exclude after all-repositories selection without expanding unsupported states", async () => {
    const client = new FakeClient({}, [
      repository("matharts/active"),
      repository("matharts/excluded"),
      repository("matharts/excluded-archived", { archived: true }),
      repository("matharts/archived", { archived: true }),
      repository("matharts/disabled", { disabled: true }),
      repository("matharts/fork", { fork: true }),
    ]);
    const repositoryScope = scope({ exclude: ["excluded", "excluded-archived"] });

    const repositories = await repositoryScope.select(client, { owner: "matharts" });

    expect(repositories.map(({ fullName }) => fullName)).toEqual(["matharts/active"]);
    expect(client.calls).toEqual(["list:matharts"]);
  });

  it("keeps disjoint include and exclude rules in deterministic policy order", async () => {
    const client = new FakeClient({
      "matharts/example": repository("matharts/example"),
      "matharts/docs": repository("matharts/docs"),
    });
    const repositoryScope = scope({
      include: ["example", "docs"],
      exclude: ["private"],
    });

    const repositories = await repositoryScope.select(client, { owner: "matharts" });

    expect(repositories.map(({ fullName }) => fullName)).toEqual([
      "matharts/example",
      "matharts/docs",
    ]);
    expect(client.calls).toEqual(["get:matharts/example", "get:matharts/docs"]);
  });

  it("rejects an explicitly excluded repository before API access", async () => {
    const client = new FakeClient({});
    const repositoryScope = scope({ exclude: ["private"] });

    await expect(
      repositoryScope.select(client, {
        owner: "matharts",
        onlyRepository: "matharts/PRIVATE",
      }),
    ).rejects.toThrow("仓库 matharts/PRIVATE 已被 repositories.exclude 排除。");
    expect(client.calls).toEqual([]);
  });

  it("allows an explicit repository that is outside a disjoint exclude-only rule", async () => {
    const client = new FakeClient({ "matharts/example": repository("matharts/example") });
    const repositoryScope = scope({ exclude: ["private"] });

    const repositories = await repositoryScope.select(client, {
      owner: "matharts",
      onlyRepository: "example",
    });

    expect(repositories.map(({ fullName }) => fullName)).toEqual(["matharts/example"]);
    expect(client.calls).toEqual(["get:matharts/example"]);
  });
});
