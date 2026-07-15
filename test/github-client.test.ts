import { describe, expect, it, vi } from "vitest";

import { GitHubClient, type HttpRequest, type HttpResponse } from "../src/github-client";

describe("GitHubClient", () => {
  it("owns GitHub paths, retries transient reads, and paginates until a short page", async () => {
    const requests: HttpRequest[] = [];
    const delays: number[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `label-${index}`,
      color: "FFFFFF",
      description: "",
    }));
    const responses: HttpResponse[] = [
      { status: 503, headers: { "retry-after": "0" }, body: '{"message":"unavailable"}' },
      { status: 200, headers: {}, body: JSON.stringify(firstPage) },
      {
        status: 200,
        headers: {},
        body: JSON.stringify([{ name: "label-100", color: "000000", description: null }]),
      },
    ];
    const client = new GitHubClient({
      token: "secret-token",
      baseUrl: "https://api.example.test/api/v3",
      requester: async (request) => {
        requests.push(request);
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected request");
        return response;
      },
      sleeper: async (delay) => delays.push(delay),
      warning: () => {},
      maxRetries: 2,
    });

    const labels = await client.listLabels("matharts/example");

    expect(labels).toHaveLength(101);
    expect(delays).toEqual([0]);
    expect(requests.map(({ method }) => method)).toEqual(["GET", "GET", "GET"]);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.example.test/api/v3/repos/matharts/example/labels?per_page=100&page=1",
      "https://api.example.test/api/v3/repos/matharts/example/labels?per_page=100&page=1",
      "https://api.example.test/api/v3/repos/matharts/example/labels?per_page=100&page=2",
    ]);
  });

  it("requires a credential-free HTTPS base URL", () => {
    expect(() => new GitHubClient({ token: "token", baseUrl: "" })).toThrow(
      "GitHub API 地址必须是有效的 HTTPS URL。",
    );
    expect(() => new GitHubClient({ token: "token", baseUrl: "http://api.example.test" })).toThrow(
      "HTTPS",
    );
    expect(
      () => new GitHubClient({ token: "token", baseUrl: "https://user@api.example.test" }),
    ).toThrow("不能包含凭据");
    expect(
      () => new GitHubClient({ token: "token", baseUrl: "https://api.example.test?" }),
    ).toThrow("不能包含凭据、查询参数或片段");
    expect(
      () => new GitHubClient({ token: "token", baseUrl: "https://api.example.test#" }),
    ).toThrow("不能包含凭据、查询参数或片段");
  });

  it("retries rate-limited reads but not ordinary forbidden responses", async () => {
    const responses: HttpResponse[] = [
      {
        status: 403,
        headers: { "retry-after": "0", "x-ratelimit-remaining": "0" },
        body: '{"message":"rate limit exceeded"}',
      },
      { status: 200, headers: {}, body: "[]" },
    ];
    const client = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async () => responses.shift()!,
      sleeper: async () => {},
      warning: () => {},
      maxRetries: 1,
    });

    await expect(client.listLabels("matharts/example")).resolves.toEqual([]);
    expect(responses).toEqual([]);

    let attempts = 0;
    const forbidden = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async () => {
        attempts += 1;
        return {
          status: 403,
          headers: { "x-ratelimit-remaining": "4999", "x-ratelimit-reset": "4102444800" },
          body: '{"message":"resource not accessible"}',
        };
      },
      sleeper: async () => {
        throw new Error("ordinary 403 must not retry");
      },
      warning: () => {},
    });
    await expect(forbidden.listLabels("matharts/example")).rejects.toThrow("Status: 403");
    expect(attempts).toBe(1);
  });

  it("does not expose a non-JSON response body in an error", async () => {
    const client = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async () => ({ status: 500, headers: {}, body: "sensitive upstream response" }),
      maxRetries: 0,
    });

    const promise = client.listLabels("matharts/example");

    await expect(promise).rejects.toThrow("GitHub API 返回了非 JSON 错误响应。");
    await expect(promise).rejects.not.toThrow("sensitive upstream response");
  });

  it("does not expose an invalid successful JSON body in an error", async () => {
    const client = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async () => ({ status: 200, headers: {}, body: "sensitive invalid JSON" }),
    });

    const promise = client.listLabels("matharts/example");

    await expect(promise).rejects.toThrow("GitHub API 返回了无效 JSON");
    await expect(promise).rejects.not.toThrow("sensitive invalid JSON");
  });

  it("never retries a mutation with an unknown outcome", async () => {
    let attempts = 0;
    const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    const client = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async () => {
        attempts += 1;
        throw timeout;
      },
      sleeper: async () => {
        throw new Error("mutation must not retry");
      },
      warning: () => {},
      maxRetries: 3,
    });

    await expect(
      client.createLabel("matharts/example", {
        name: "type: bug",
        color: "D73A4A",
        description: "bug",
        aliases: [],
      }),
    ).rejects.toBe(timeout);
    expect(attempts).toBe(1);
  });

  it("does not retry permanent fetch TypeErrors", async () => {
    let attempts = 0;
    const tlsError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("self-signed certificate"), {
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      }),
    });
    const client = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async () => {
        attempts += 1;
        throw tlsError;
      },
      sleeper: async () => {},
      warning: () => {},
      maxRetries: 3,
    });

    await expect(client.listLabels("matharts/example")).rejects.toBe(tlsError);
    expect(attempts).toBe(1);
  });

  it("retries transient fetch errors identified by their cause", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const timeout = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" }),
    });
    const client = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async () => {
        attempts += 1;
        if (attempts === 1) throw timeout;
        return { status: 200, headers: {}, body: "[]" };
      },
      sleeper: async (delay) => {
        delays.push(delay);
      },
      warning: () => {},
      maxRetries: 1,
    });

    await expect(client.listLabels("matharts/example")).resolves.toEqual([]);
    expect(attempts).toBe(2);
    expect(delays).toEqual([1]);
  });

  it("surfaces redirect responses instead of following them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.redirect === "manual") {
        return new Response('{"message":"redirected"}', {
          status: 307,
          headers: { location: "https://api.example.test/redirected" },
        });
      }
      return new Response("[]", { status: 200 });
    });
    const client = new GitHubClient({ token: "token", baseUrl: "https://api.example.test" });

    try {
      await expect(client.listLabels("matharts/example")).rejects.toThrow("Status: 307");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("encapsulates mutation paths and payloads", async () => {
    const requests: HttpRequest[] = [];
    const client = new GitHubClient({
      token: "token",
      baseUrl: "https://api.example.test",
      requester: async (request) => {
        requests.push(request);
        return { status: request.method === "DELETE" ? 204 : 200, headers: {}, body: "" };
      },
    });
    const desired = { name: "type: bug", color: "D73A4A", description: "bug", aliases: [] };

    await client.createLabel("matharts/example", desired);
    await client.updateLabel("matharts/example", "old bug", desired);
    await client.deleteLabel("matharts/example", "type: obsolete");

    expect(requests.map(({ method, url }) => [method, url])).toEqual([
      ["POST", "https://api.example.test/repos/matharts/example/labels"],
      ["PATCH", "https://api.example.test/repos/matharts/example/labels/old%20bug"],
      ["DELETE", "https://api.example.test/repos/matharts/example/labels/type%3A%20obsolete"],
    ]);
    expect(JSON.parse(requests[1]?.body ?? "null")).toEqual({
      new_name: "type: bug",
      color: "D73A4A",
      description: "bug",
    });
  });
});
