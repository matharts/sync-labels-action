import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const script = join(process.cwd(), "script/validate-action-pins.ts");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("validate-action-pins", () => {
  it("accepts this repository and rejects mutable external Action references", async () => {
    const valid = spawnSync("nub", [script], { cwd: process.cwd(), encoding: "utf8" });
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain("全部固定到 Commit SHA 或容器 digest");

    const directory = await mkdtemp(join(tmpdir(), "action-pins-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, ".github/workflows"), { recursive: true });
    await writeFile(
      join(directory, ".github/workflows/test.yml"),
      "steps:\n  - uses: actions/checkout@v7\n",
      "utf8",
    );
    const invalid = spawnSync("nub", [script], { cwd: directory, encoding: "utf8" });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("必须固定到完整 Commit SHA");
  });
});
