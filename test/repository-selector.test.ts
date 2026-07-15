import { describe, expect, it } from "vitest";

import type { RepositoryCatalogPort } from "../src/github-port";
import type { RepositoryMetadata } from "../src/repository-types";
import { RepositorySelector } from "../src/repository-selector";

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

function repository(fullName: string, overrides: Partial<RepositoryMetadata> = {}): RepositoryMetadata {
  return { fullName, archived: false, disabled: false, fork: false, ...overrides };
}

describe("RepositorySelector", () => {
  it("loads only allowlisted repositories in policy order", async () => {
    const client = new FakeClient({
      "matharts/example": repository("matharts/example"),
      "matharts/docs": repository("matharts/docs"),
    });
    const selector = new RepositorySelector(client, { repositoryNames: ["example", "docs"] });

    const repositories = await selector.select({ owner: "matharts", onlyRepository: "" });

    expect(repositories.map(({ fullName }) => fullName)).toEqual(["matharts/example", "matharts/docs"]);
    expect(client.calls).toEqual(["get:matharts/example", "get:matharts/docs"]);
  });

  it("filters unsupported repositories only in all-repositories mode", async () => {
    const client = new FakeClient({}, [
      repository("matharts/active"),
      repository("matharts/archived", { archived: true }),
      repository("matharts/disabled", { disabled: true }),
      repository("matharts/fork", { fork: true }),
    ]);
    const selector = new RepositorySelector(client, { repositoryNames: undefined });

    const repositories = await selector.select({ owner: "matharts" });

    expect(repositories.map(({ fullName }) => fullName)).toEqual(["matharts/active"]);
    expect(client.calls).toEqual(["list:matharts"]);
  });

  it("rejects a requested repository outside the allowlist before API access", async () => {
    const client = new FakeClient({});
    const selector = new RepositorySelector(client, { repositoryNames: ["example"] });

    await expect(selector.select({ owner: "matharts", onlyRepository: "private" })).rejects.toThrow(
      "不在标签同步 Allowlist",
    );
    expect(client.calls).toEqual([]);
  });

  it("accepts owner/name when selecting one repository without an allowlist", async () => {
    const client = new FakeClient({ "matharts/example": repository("matharts/example") });
    const selector = new RepositorySelector(client, { repositoryNames: undefined });

    const repositories = await selector.select({ owner: "matharts", onlyRepository: "matharts/example" });

    expect(repositories.map(({ fullName }) => fullName)).toEqual(["matharts/example"]);
    expect(client.calls).toEqual(["get:matharts/example"]);
  });

  it("fails when an explicitly allowlisted repository is archived", async () => {
    const client = new FakeClient({
      "matharts/example": repository("matharts/example", { archived: true }),
    });
    const selector = new RepositorySelector(client, { repositoryNames: ["example"] });

    await expect(selector.select({ owner: "matharts" })).rejects.toThrow(
      "Allowlist 仓库 matharts/example 处于不可同步状态：archived",
    );
  });
});
