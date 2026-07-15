import { describe, expect, it } from "vitest";

import { RuntimeOptions } from "../src/runtime-options";

function load(overrides: Record<string, string> = {}): RuntimeOptions {
  return RuntimeOptions.load({
    SYNC_LABELS_TOKEN: "test-token",
    SYNC_LABELS_OWNER: "matharts",
    ...overrides,
  });
}

describe("RuntimeOptions", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["yes", true],
    ["on", true],
    ["false", false],
    ["0", false],
    ["no", false],
    ["off", false],
    [" TRUE ", true],
  ])("parses dry-run value %j", (input, expected) => {
    expect(load({ SYNC_LABELS_DRY_RUN: input }).mode).toBe(expected ? "preview" : "apply");
  });

  it("rejects invalid booleans before doing any work", () => {
    expect(() => load({ SYNC_LABELS_DRY_RUN: "treu" })).toThrow(
      "SYNC_LABELS_DRY_RUN 必须是 true/false、1/0、yes/no 或 on/off。",
    );
  });

  it("validates required inputs and supplies v1.3 defaults", () => {
    expect(() => load({ SYNC_LABELS_TOKEN: "" })).toThrow("SYNC_LABELS_TOKEN 不能为空。");
    expect(() => load({ SYNC_LABELS_OWNER: "" })).toThrow("SYNC_LABELS_OWNER 不能为空。");

    expect(load()).toEqual({
      mode: "preview",
      token: "test-token",
      owner: "matharts",
      configFile: ".github/labels.yml",
      policyFile: ".github/label-policy.yml",
      onlyRepository: "",
      apiUrl: "https://api.github.com",
    });
  });

  it("loads validation mode without credentials or synchronization-only inputs", () => {
    expect(
      RuntimeOptions.load({
        SYNC_LABELS_VALIDATE_ONLY: "true",
        SYNC_LABELS_TOKEN: "",
        SYNC_LABELS_OWNER: "",
        SYNC_LABELS_DRY_RUN: "not-a-boolean",
        SYNC_LABELS_CONFIG_FILE: "config.yml",
        SYNC_LABELS_POLICY_FILE: "policy.yml",
      }),
    ).toEqual({
      mode: "validate",
      configFile: "config.yml",
      policyFile: "policy.yml",
    });
  });

  it("rejects an invalid validate-only boolean", () => {
    expect(() => load({ SYNC_LABELS_VALIDATE_ONLY: "sometimes" })).toThrow(
      "SYNC_LABELS_VALIDATE_ONLY 必须是 true/false、1/0、yes/no 或 on/off。",
    );
  });
});
