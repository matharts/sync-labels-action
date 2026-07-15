import { describe, expect, it } from "vitest";

import { labelKey } from "../src/label-identity";

describe("label identity", () => {
  it("normalizes label identity with Unicode NFC and case folding", () => {
    expect(labelKey("CAFE\u0301")).toBe("café");
  });
});
