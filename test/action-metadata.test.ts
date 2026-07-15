import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("action metadata", () => {
  it("declares a Node 24 JavaScript Action with the stable v1.3 interface", async () => {
    const metadata = parse(await readFile(join(process.cwd(), "action.yml"), "utf8")) as {
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

    expect(metadata.runs).toEqual({ using: "node24", main: "dist/index.js" });
    expect(Object.keys(metadata.outputs).sort()).toEqual(outputNames.sort());
    for (const output of Object.values(metadata.outputs)) {
      expect(output.description).not.toBe("");
      expect(output).not.toHaveProperty("value");
    }
  });
});
