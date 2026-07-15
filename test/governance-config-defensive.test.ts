import { afterEach, describe, expect, it, vi } from "vitest";

const yamlMocks = vi.hoisted(() => ({
  outcomes: [] as Array<() => unknown>,
}));

vi.mock("yaml", () => ({
  parseDocument: () => ({
    errors: [],
    toJS: () => yamlMocks.outcomes.shift()?.(),
  }),
}));

import { GovernanceConfig } from "../src/governance-config";

const paths = {
  labelsPath: ".github/labels.yml",
  policyPath: ".github/label-policy.yml",
};

afterEach(() => {
  yamlMocks.outcomes.length = 0;
});

describe("GovernanceConfig defensive YAML conversion", () => {
  it.each([
    ["custom object", () => new (class Unsupported {})(), "YAML 包含不允许的对象类型：Unsupported"],
    ["bigint", () => 1n, "YAML 包含不允许的对象类型：bigint"],
    [
      "unknown constructor",
      () => Object.create({ constructor: undefined }) as unknown,
      "YAML 包含不允许的对象类型：unknown",
    ],
  ])("rejects an unsupported %s returned by the YAML library", async (_case, outcome, message) => {
    yamlMocks.outcomes.push(outcome);

    await expect(GovernanceConfig.load(paths)).rejects.toThrow(message);
  });

  it("accepts a null-prototype YAML record before validating its shape", async () => {
    yamlMocks.outcomes.push(() => Object.create(null) as unknown);

    await expect(GovernanceConfig.load(paths)).rejects.toThrow("YAML 根节点必须是数组");
  });

  it("stringifies a non-Error thrown by the YAML library", async () => {
    yamlMocks.outcomes.push(() => {
      throw "plain parser failure";
    });

    await expect(GovernanceConfig.load(paths)).rejects.toThrow("plain parser failure");
  });
});
