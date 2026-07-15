import { describe, expect, it } from "vitest";

import { Application, type ActionLogger } from "../src/application";
import type { LabelSyncPort } from "../src/github-port";
import type { ExistingLabel, PlanningConfig } from "../src/label-types";
import type { RepositoryTarget } from "../src/repository-types";
import { zeroCounts } from "../src/sync-result";

function repository(fullName: string): RepositoryTarget {
  return { fullName };
}

describe("Application", () => {
  it("plans every repository before the first mutation", async () => {
    const operations: string[] = [];
    const existing: Readonly<Record<string, readonly ExistingLabel[]>> = {
      "matharts/healthy": [],
      "matharts/ambiguous": [
        { name: "enhancement", color: "FFFFFF", description: "legacy" },
        { name: "feature", color: "FFFFFF", description: "legacy" },
      ],
    };
    const client: LabelSyncPort = {
      async listLabels(fullName) {
        operations.push(`plan:${fullName}`);
        return existing[fullName] ?? [];
      },
      async createLabel(fullName, desired) {
        operations.push(`create:${fullName}:${desired.name}`);
      },
      async updateLabel() {},
      async deleteLabel() {},
    };
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
    const logger: ActionLogger = {
      info: () => {},
      error: () => {},
      startGroup: () => {},
      endGroup: () => {},
    };
    const application = new Application({ client, config, dryRun: false, logger });

    const result = await application.run([
      repository("matharts/healthy"),
      repository("matharts/ambiguous"),
    ]);

    expect(operations).toEqual([
      "plan:matharts/healthy",
      "plan:matharts/ambiguous",
      "create:matharts/healthy:type: feature",
    ]);
    expect(result.failures.map(({ repository: name }) => name)).toEqual(["matharts/ambiguous"]);
  });

  it("blocks every mutation when the complete plan exceeds the total deletion limit", async () => {
    const operations: string[] = [];
    const client: LabelSyncPort = {
      async listLabels(fullName) {
        operations.push(`plan:${fullName}`);
        return [
          { name: "type: bug", color: "D73A4A", description: "bug" },
          { name: "type: obsolete", color: "FFFFFF", description: "stale" },
        ];
      },
      async createLabel() {},
      async updateLabel() {},
      async deleteLabel(fullName, name) {
        operations.push(`delete:${fullName}:${name}`);
      },
    };
    const config = {
      labels: [{ name: "type: bug", color: "D73A4A", description: "bug", aliases: [] }],
      managed: () => true,
      safety: { deletions: "allow" as const, maxDeletionsTotal: 1 },
    };
    const logger: ActionLogger = {
      info: () => {},
      error: () => {},
      startGroup: () => {},
      endGroup: () => {},
    };
    const application = new Application({ client, config, dryRun: false, logger });

    const result = await application.run([repository("matharts/one"), repository("matharts/two")]);

    expect(operations).toEqual(["plan:matharts/one", "plan:matharts/two"]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatchObject({
      phase: "safety",
      error: expect.stringContaining("总删除操作数 2"),
    });
    expect(result.totals).toEqual(zeroCounts());
  });

  it("continues after one repository fails and preserves its completed counts", async () => {
    const client: LabelSyncPort = {
      async listLabels(fullName) {
        return fullName.endsWith("failing")
          ? [{ name: "type: obsolete", color: "FFFFFF", description: "stale" }]
          : [];
      },
      async createLabel() {},
      async updateLabel() {},
      async deleteLabel(fullName) {
        if (fullName.endsWith("failing")) throw new Error("simulated failure");
      },
    };
    const config: PlanningConfig = {
      labels: [{ name: "type: bug", color: "D73A4A", description: "bug", aliases: [] }],
      managed: () => true,
    };
    const events: string[] = [];
    const logger: ActionLogger = {
      info: (message) => events.push(`info:${message}`),
      error: (message) => events.push(`error:${message}`),
      startGroup: () => {},
      endGroup: () => {},
    };
    const application = new Application({ client, config, dryRun: false, logger });

    const result = await application.run([
      repository("matharts/failing"),
      repository("matharts/healthy"),
    ]);

    expect(result.success).toBe(false);
    expect(result.failures.map(({ repository: name }) => name)).toEqual(["matharts/failing"]);
    expect(result.outcomes.map(({ repository: name }) => name)).toEqual([
      "matharts/failing",
      "matharts/healthy",
    ]);
    expect(result.outcomes[0]?.counts.created).toBe(1);
    expect(result.totals.created).toBe(2);
    expect(events.join("\n")).toContain("simulated failure");
  });
});
