import { describe, expect, it } from "vitest";

import type { LabelWriterPort } from "../src/github-port";
import type { LabelDefinition } from "../src/label-types";
import { OperationCounts } from "../src/operation-counts";
import { RepositorySyncError, SyncExecutor } from "../src/sync-executor";
import { SyncPlan } from "../src/sync-plan";

class RecordingClient implements LabelWriterPort {
  readonly calls: string[] = [];

  async createLabel(fullName: string, desired: LabelDefinition): Promise<void> {
    this.calls.push(`create:${fullName}:${desired.name}`);
  }
  async updateLabel(
    fullName: string,
    currentName: string,
    desired: LabelDefinition,
  ): Promise<void> {
    this.calls.push(`update:${fullName}:${currentName}->${desired.name}`);
  }
  async deleteLabel(fullName: string, name: string): Promise<void> {
    this.calls.push(`delete:${fullName}:${name}`);
  }
}

const bug: LabelDefinition = {
  name: "type: bug",
  color: "D73A4A",
  description: "bug",
  aliases: ["bug"],
};

describe("SyncExecutor", () => {
  it("applies a validated plan sequentially through the GitHub client seam", async () => {
    const client = new RecordingClient();
    const plan = new SyncPlan([
      { action: "rename", name: "bug", desired: bug },
      {
        action: "create",
        name: "help wanted",
        desired: { ...bug, name: "help wanted", aliases: [] },
      },
      { action: "delete", name: "type: obsolete", reason: "stale_managed" },
      { action: "preserve", name: "custom" },
    ]);
    const lines: string[] = [];

    const counts = await new SyncExecutor(client, false, (line) => lines.push(line)).apply(
      "matharts/example",
      plan,
    );

    expect(counts).toEqual(plan.counts);
    expect(client.calls).toEqual([
      "update:matharts/example:bug->type: bug",
      "create:matharts/example:help wanted",
      "delete:matharts/example:type: obsolete",
    ]);
    expect(lines).toContain("PRESERVE        repository label custom");
  });

  it("does not mutate during dry-run", async () => {
    const client = new RecordingClient();
    const plan = new SyncPlan([
      { action: "create", name: bug.name, desired: bug },
      { action: "delete", name: "type: obsolete", reason: "stale_managed" },
    ]);

    const counts = await new SyncExecutor(client, true, () => {}).apply("matharts/example", plan);

    expect(counts).toEqual(plan.counts);
    expect(client.calls).toEqual([]);
  });

  it("reports only changes completed before a mutation fails", async () => {
    let creates = 0;
    const client = new RecordingClient();
    client.createLabel = async (fullName, desired) => {
      creates += 1;
      client.calls.push(`create:${fullName}:${desired.name}`);
      if (creates === 2) throw new Error("second mutation failed");
    };
    const plan = new SyncPlan([
      { action: "create", name: bug.name, desired: bug },
      { action: "create", name: "help wanted", desired: { ...bug, name: "help wanted" } },
    ]);

    const promise = new SyncExecutor(client, false, () => {}).apply("matharts/example", plan);

    await expect(promise).rejects.toThrow("second mutation failed");
    await expect(promise).rejects.toMatchObject({
      counts: new OperationCounts({ created: 1 }),
    } satisfies Partial<RepositorySyncError>);
  });
});
