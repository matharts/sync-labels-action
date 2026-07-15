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
  it.each([
    [{ include: [] }, "repositories.include 不能为空"],
    [{ include: ["bad/name"] }, "repositories.include 包含无效仓库名称：bad/name"],
    [{ exclude: ["Example", "example"] }, "repositories.exclude 包含重复值"],
    [
      { include: ["B", "a"], exclude: ["a", "b"] },
      "repositories.include 与 repositories.exclude 不能重叠：a, B",
    ],
  ] satisfies readonly (readonly [RepositoryScopePolicy, string])[])(
    "rejects an invalid repository policy %#",
    (policy, message) => {
      expect(() => scope(policy)).toThrow(message);
    },
  );

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

  it("selects an explicitly requested allowlisted repository by canonical policy spelling", async () => {
    const client = new FakeClient({ "matharts/example": repository("matharts/example") });
    const repositoryScope = scope({ include: ["example"] });

    const repositories = await repositoryScope.select(client, {
      owner: "matharts",
      onlyRepository: "EXAMPLE",
    });

    expect(repositories).toEqual([{ fullName: "matharts/example" }]);
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

  it("labels an unsupported explicit repository outside an allowlist", async () => {
    const client = new FakeClient({
      "matharts/example": repository("matharts/example", { archived: true }),
    });

    await expect(
      scope().select(client, { owner: "matharts", onlyRepository: "example" }),
    ).rejects.toThrow("仓库 matharts/example 处于不可同步状态：archived");
  });

  it.each([
    ["other/example", "指定仓库不属于 matharts 组织"],
    ["bad name", "指定仓库名称无效"],
  ])("rejects an invalid explicit repository %s", async (onlyRepository, message) => {
    await expect(
      scope().select(new FakeClient({}), { owner: "matharts", onlyRepository }),
    ).rejects.toThrow(message);
  });

  it.each(["invalid", "other/example", "matharts/"])(
    "rejects an inconsistent organization repository response %j",
    async (fullName) => {
      const client = new FakeClient({}, [repository(fullName)]);

      await expect(scope().select(client, { owner: "matharts" })).rejects.toThrow("仓库解析不一致");
    },
  );

  it("rejects an inconsistent explicit repository response", async () => {
    const client = new FakeClient({ "matharts/example": repository("matharts/other") });

    await expect(
      scope().select(client, { owner: "matharts", onlyRepository: "example" }),
    ).rejects.toThrow("仓库解析不一致：期望 matharts/example");
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
