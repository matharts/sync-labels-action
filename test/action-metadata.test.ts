import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("action metadata", () => {
  it("keeps release metadata on v1.4.0 while declaring validate_only", async () => {
    const packageMetadata = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
    const metadata = parse(await readFile(join(process.cwd(), "action.yml"), "utf8")) as {
      inputs: Record<string, { description: string; required: boolean; default?: string }>;
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
    expect(metadata.inputs.token?.required).toBe(false);
    expect(metadata.inputs.owner?.required).toBe(false);
    expect(metadata.inputs.config_file?.default).toBe(".github/labels.yml");
    expect(metadata.inputs.policy_file?.default).toBe(".github/label-policy.yml");
    expect(metadata.inputs.dry_run?.default).toBe("true");
    expect(metadata.inputs.validate_only).toMatchObject({
      required: false,
      default: "false",
    });
    expect(metadata.inputs.repository?.default).toBe("");
    expect(metadata.inputs.api_url?.default).toBe("https://api.github.com");
    expect(metadata.inputs.validate_only?.description).toContain("不访问 GitHub API");
    expect(Object.keys(metadata.outputs).sort()).toEqual(outputNames.sort());
    expect(metadata.outputs.changed?.description).toBe(
      "预览模式表示完整计划是否包含变更；写入模式表示是否实际完成至少一项变更",
    );
    expect(readme).toContain("| `changed`      | 预览是否计划变更；写入是否完成变更 |");
    for (const output of Object.values(metadata.outputs)) {
      expect(output.description).not.toBe("");
      expect(output).not.toHaveProperty("value");
    }
  });
});
