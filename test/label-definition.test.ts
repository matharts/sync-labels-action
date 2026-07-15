import { describe, expect, it } from "vitest";

import { validatedLabelDefinition } from "../src/label-definition";

describe("validatedLabelDefinition", () => {
  it.each([
    [null, "标签 必须是对象。"],
    [{}, "标签 缺少字段：name, color, description, aliases"],
    [
      { name: "type: bug", color: "D73A4A", description: " bug ", aliases: [] },
      "标签 description 不能包含首尾空白。",
    ],
  ])("rejects a non-canonical label %#", (value, message) => {
    expect(() => validatedLabelDefinition(value, "标签 ")).toThrow(message);
  });
});
