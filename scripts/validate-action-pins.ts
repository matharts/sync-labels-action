#!/usr/bin/env nub

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const fullCommitSha = /^[0-9a-fA-F]{40}$/;
const containerDigest = /^docker:\/\/.+@sha256:[0-9a-fA-F]{64}$/;
const usesPattern = /^\s*(?:-\s*)?uses\s*:\s*(?:"([^"]+)"|'([^']+)'|([^#\s]+))/;

const root = process.cwd();
const files = await actionFiles(root);
let externalReferences = 0;
let errors = 0;

for (const absolutePath of files) {
  const file = relative(root, absolutePath);
  const lines = (await readFile(absolutePath, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    const match = usesPattern.exec(line);
    if (match === null) continue;
    const reference = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (reference.startsWith("./")) continue;

    externalReferences += 1;
    if (reference.startsWith("docker://")) {
      if (containerDigest.test(reference)) continue;
      console.error(`${file}:${index + 1}: Docker Action 必须固定到 sha256 digest：${reference}`);
      errors += 1;
      continue;
    }

    const separator = reference.lastIndexOf("@");
    const action = separator >= 0 ? reference.slice(0, separator) : "";
    const revision = separator >= 0 ? reference.slice(separator + 1) : "";
    if (action.length > 0 && fullCommitSha.test(revision)) continue;

    console.error(`${file}:${index + 1}: 外部 Action 必须固定到完整 Commit SHA：${reference}`);
    errors += 1;
  }
}

if (errors === 0) {
  console.log(
    `已验证 ${externalReferences} 个外部 Action 引用，全部固定到 Commit SHA 或容器 digest。`,
  );
} else {
  process.exitCode = 1;
}

async function actionFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of ["action.yml", "action.yaml"]) {
    const path = join(directory, name);
    if (await isFile(path)) files.push(path);
  }

  const workflows = join(directory, ".github/workflows");
  try {
    for (const entry of await readdir(workflows, { withFileTypes: true })) {
      if (entry.isFile() && /\.ya?ml$/.test(entry.name)) files.push(join(workflows, entry.name));
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return files.sort();
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
