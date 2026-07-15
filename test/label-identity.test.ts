import { describe, expect, it } from "vitest";

import { escapePathSegment, labelKey, repositoryPath } from "../src/label-identity";

describe("label identity", () => {
  it("matches the Ruby v1.3 normalization and form-component escaping contract", () => {
    expect(labelKey("CAFE\u0301")).toBe("café");
    expect(escapePathSegment("a b!'()*~")).toBe("a%20b%21%27%28%29*%7E");
    expect(repositoryPath("matharts/type: labels")).toBe("matharts/type%3A%20labels");
  });
});
