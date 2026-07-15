import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("action metadata", () => {
  it("declares v1.4.0 on Node 24 with the stable v1.3 interface", async () => {
    const packageMetadata = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const metadata = parse(await readFile(join(process.cwd(), "action.yml"), "utf8")) as {
      inputs: Record<string, { description: string }>;
      runs: { using: string; main?: string; steps?: unknown };
      outputs: Record<string, { description: string; value?: string }>;
    };
    const outputNames = [
      "changed",
      "repositories",
      "created",
      "updated",
      "renamed",
      "deleted",
      "unchanged",
      "preserved",
      "failures",
    ];

    expect(packageMetadata.version).toBe("1.4.0");
    expect(metadata.runs).toEqual({ using: "node24", main: "dist/index.js" });
    expect(metadata.inputs.repository?.description).toContain("repositories.exclude");
    expect(Object.keys(metadata.outputs).sort()).toEqual(outputNames.sort());
    for (const output of Object.values(metadata.outputs)) {
      expect(output.description).not.toBe("");
      expect(output).not.toHaveProperty("value");
    }
  });
});
