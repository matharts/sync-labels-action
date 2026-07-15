import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runConfigValidationCommand } from "../src/config-validation-command";
import { GovernanceConfig } from "../src/governance-config";

const temporaryDirectories: string[] = [];
const LABELS = '- name: "type: bug"\n  color: "D73A4A"\n';
const INVALID_LABELS = '- name: "type: bug"\n  color: "D73A4A"\n  aliases: [bug]\n';
const POLICY =
  'version: 1\nmanaged:\n  prefixes: ["type:"]\n  exact_names: []\n  legacy_names: []\n';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sync-labels-command-"));
  temporaryDirectories.push(directory);
  return directory;
}

function commandIO(cwd: string) {
  const information: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      cwd,
      info: (message: string) => information.push(message),
      error: (message: string) => errors.push(message),
    },
    information,
    errors,
  };
}

describe("config validation command", () => {
  it("prints help without reading configuration", async () => {
    const { io, information, errors } = commandIO("/unused");

    const exitCode = await runConfigValidationCommand(["--help"], io);

    expect(exitCode).toBe(0);
    expect(information).toHaveLength(1);
    expect(information[0]).toContain("用法：pnpm validate:config");
    expect(errors).toEqual([]);
  });

  it("validates the default configuration paths without GitHub credentials", async () => {
    const directory = await temporaryDirectory();
    const githubDirectory = join(directory, ".github");
    await mkdir(githubDirectory);
    await writeFile(join(githubDirectory, "labels.yml"), LABELS, "utf8");
    await writeFile(join(githubDirectory, "label-policy.yml"), POLICY, "utf8");
    const { io, information, errors } = commandIO(directory);

    const exitCode = await runConfigValidationCommand([], io);

    expect(exitCode).toBe(0);
    expect(information[0]).toBe("配置校验通过：1 个标签。");
    expect(information).toContain(`标签配置：${join(githubDirectory, "labels.yml")}`);
    expect(information).toContain(`同步策略：${join(githubDirectory, "label-policy.yml")}`);
    expect(errors).toEqual([]);
  });

  it("accepts custom paths and returns a nonzero result for the shared validation error", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "labels.custom.yml"), INVALID_LABELS, "utf8");
    await writeFile(join(directory, "policy.custom.yml"), POLICY, "utf8");
    const { io, information, errors } = commandIO(directory);

    const exitCode = await runConfigValidationCommand(
      ["--", "--config-file", "labels.custom.yml", "--policy-file", "policy.custom.yml"],
      io,
    );

    expect(exitCode).toBe(1);
    expect(information).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("标签 aliases 必须同时登记到策略 legacy_names：bug");
  });

  it("reports unknown or incomplete options as command errors", async () => {
    const directory = await temporaryDirectory();
    const unknown = commandIO(directory);
    const incomplete = commandIO(directory);

    await expect(runConfigValidationCommand(["--unknown"], unknown.io)).resolves.toBe(1);
    await expect(runConfigValidationCommand(["--config-file"], incomplete.io)).resolves.toBe(1);
    expect(unknown.errors).toEqual(["配置校验失败：未知参数：--unknown"]);
    expect(incomplete.errors).toEqual(["配置校验失败：--config-file 缺少路径。"]);
  });

  it("stringifies a non-Error validation failure", async () => {
    const load = vi.spyOn(GovernanceConfig, "load").mockRejectedValueOnce("plain failure");
    const command = commandIO("/unused");

    const exitCode = await runConfigValidationCommand([], command.io);
    load.mockRestore();

    expect(exitCode).toBe(1);
    expect(command.errors).toEqual(["配置校验失败：plain failure"]);
  });
});
