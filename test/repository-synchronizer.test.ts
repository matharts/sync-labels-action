import { describe, expect, it } from "vitest";

import type { GitHubClientPort, Repository } from "../src/github-client";
import type { ExistingLabel, LabelDefinition, PlanningConfig } from "../src/label-types";
import { RepositorySynchronizer, type ActionLogger } from "../src/repository-synchronizer";
import { RepositorySyncError, zeroCounts } from "../src/sync-result";

class FakeClient implements GitHubClientPort {
  readonly mutations: string[] = [];

  constructor(private readonly labels: readonly ExistingLabel[]) {}

  async listOrganizationRepositories(_owner: string): Promise<readonly Repository[]> { return []; }
  async getRepository(_owner: string, _name: string): Promise<Repository> { throw new Error("unused"); }
  async listLabels(_fullName: string): Promise<readonly ExistingLabel[]> { return this.labels; }
  async createLabel(_fullName: string, desired: LabelDefinition): Promise<void> { this.mutations.push(`create:${desired.name}`); }
  async updateLabel(_fullName: string, currentName: string, _desired: LabelDefinition): Promise<void> { this.mutations.push(`update:${currentName}`); }
  async deleteLabel(_fullName: string, name: string): Promise<void> { this.mutations.push(`delete:${name}`); }
}

describe("RepositorySynchronizer", () => {
  it("finishes planning before the first mutation and always closes the log group", async () => {
    const client = new FakeClient([
      { name: "enhancement", color: "FFFFFF", description: "legacy" },
      { name: "feature", color: "FFFFFF", description: "legacy" },
    ]);
    const config: PlanningConfig = {
      labels: [
        {
          name: "type: feature",
          color: "A2EEEF",
          description: "feature",
          aliases: ["enhancement", "feature"],
        },
      ],
      managed: () => true,
    };
    const events: string[] = [];
    const logger: ActionLogger = {
      info: (message) => events.push(`info:${message}`),
      error: (message) => events.push(`error:${message}`),
      startGroup: (name) => events.push(`start:${name}`),
      endGroup: () => events.push("end"),
    };

    const promise = new RepositorySynchronizer(client, config, false, logger).sync("matharts/example");

    await expect(promise).rejects.toMatchObject({ counts: zeroCounts() } satisfies Partial<RepositorySyncError>);
    await expect(promise).rejects.toThrow("多个旧标签同时映射");
    expect(client.mutations).toEqual([]);
    expect(events).toEqual(["start:matharts/example", "end"]);
  });
});
