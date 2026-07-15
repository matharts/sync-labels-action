import { escapePathSegment, repositoryPath } from "./label-identity";
import type { ExistingLabel, LabelDefinition } from "./label-types";

export interface Repository {
  readonly fullName: string;
  readonly archived: boolean;
  readonly disabled: boolean;
  readonly fork: boolean;
}

export interface GitHubClientPort {
  listOrganizationRepositories(owner: string): Promise<readonly Repository[]>;
  getRepository(owner: string, name: string): Promise<Repository>;
  listLabels(fullName: string): Promise<readonly ExistingLabel[]>;
  createLabel(fullName: string, desired: LabelDefinition): Promise<void>;
  updateLabel(fullName: string, currentName: string, desired: LabelDefinition): Promise<void>;
  deleteLabel(fullName: string, name: string): Promise<void>;
}

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

type Requester = (request: HttpRequest) => Promise<HttpResponse>;
type Sleeper = (delaySeconds: number) => Promise<unknown>;

interface GitHubClientOptions {
  readonly token: string;
  readonly baseUrl: string;
  readonly requester?: Requester;
  readonly sleeper?: Sleeper;
  readonly warning?: (message: string) => void;
  readonly maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY = 60;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const TRANSIENT_NETWORK_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);

export class GitHubClient implements GitHubClientPort {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #requester: Requester;
  readonly #sleeper: Sleeper;
  readonly #warning: (message: string) => void;
  readonly #maxRetries: number;

  constructor(options: GitHubClientOptions) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl);
    } catch (error) {
      throw new TypeError("GitHub API 地址必须是有效的 HTTPS URL。", { cause: error });
    }
    if (baseUrl.protocol !== "https:" || baseUrl.hostname.length === 0) {
      throw new TypeError("GitHub API 地址必须是有效的 HTTPS URL。");
    }
    const hasQueryOrFragment = baseUrl.href.includes("?") || baseUrl.href.includes("#");
    if (baseUrl.username.length > 0 || baseUrl.password.length > 0 || hasQueryOrFragment) {
      throw new TypeError("GitHub API 地址不能包含凭据、查询参数或片段。");
    }

    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new TypeError("max_retries 不能小于 0。");
    }

    this.#token = options.token;
    this.#baseUrl = baseUrl.href.replace(/\/$/, "");
    this.#requester = options.requester ?? performRequest;
    this.#sleeper = options.sleeper ?? sleep;
    this.#warning = options.warning ?? console.warn;
    this.#maxRetries = maxRetries;
  }

  async listOrganizationRepositories(owner: string): Promise<readonly Repository[]> {
    const path = `/orgs/${escapePathSegment(owner)}/repos?type=all&sort=full_name&direction=asc`;
    return (await this.#paginate(path)).map(parseRepository);
  }

  async getRepository(owner: string, name: string): Promise<Repository> {
    const value = await this.#requestJson(
      "GET",
      `/repos/${escapePathSegment(owner)}/${escapePathSegment(name)}`,
    );
    return parseRepository(value);
  }

  async listLabels(fullName: string): Promise<readonly ExistingLabel[]> {
    const values = await this.#paginate(`/repos/${repositoryPath(fullName)}/labels`);
    return values.map(parseLabel);
  }

  async createLabel(fullName: string, desired: LabelDefinition): Promise<void> {
    await this.#requestJson("POST", `/repos/${repositoryPath(fullName)}/labels`, {
      name: desired.name,
      color: desired.color,
      description: desired.description,
    });
  }

  async updateLabel(fullName: string, currentName: string, desired: LabelDefinition): Promise<void> {
    await this.#requestJson(
      "PATCH",
      `/repos/${repositoryPath(fullName)}/labels/${escapePathSegment(currentName)}`,
      {
        new_name: desired.name,
        color: desired.color,
        description: desired.description,
      },
    );
  }

  async deleteLabel(fullName: string, name: string): Promise<void> {
    await this.#requestJson(
      "DELETE",
      `/repos/${repositoryPath(fullName)}/labels/${escapePathSegment(name)}`,
    );
  }

  async #paginate(path: string): Promise<unknown[]> {
    const results: unknown[] = [];
    let page = 1;

    for (;;) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await this.#requestJson("GET", `${path}${separator}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) {
        throw new Error("GitHub API 分页结果不是数组。");
      }
      results.push(...batch);
      if (batch.length < 100) return results;
      page += 1;
    }
  }

  async #requestJson(
    method: HttpRequest["method"],
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.#token}`,
      "User-Agent": "matharts-sync-labels",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (serializedBody !== undefined) headers["Content-Type"] = "application/json";

    const request: HttpRequest = serializedBody === undefined
      ? { method, url: `${this.#baseUrl}${path}`, headers }
      : { method, url: `${this.#baseUrl}${path}`, headers, body: serializedBody };
    const response = await this.#requestWithRetries(request);

    if (response.status < 200 || response.status > 299) {
      throw githubResponseError(method, path, response);
    }
    if (response.body.length === 0) return undefined;
    try {
      return JSON.parse(response.body) as unknown;
    } catch (error) {
      throw new Error(
        `GitHub API 返回了无效 JSON（Method: ${method}, Path: ${path}, Status: ${response.status}）。`,
        { cause: error },
      );
    }
  }

  async #requestWithRetries(request: HttpRequest): Promise<HttpResponse> {
    let attempt = 0;
    const idempotent = request.method === "GET";

    for (;;) {
      let response: HttpResponse;
      try {
        response = await this.#requester(request);
      } catch (error) {
        if (!idempotent || attempt >= this.#maxRetries || !isTransientNetworkError(error)) {
          throw error;
        }
        const delay = exponentialBackoff(attempt);
        this.#warning(
          `GitHub API 网络错误，${delay} 秒后重试（${attempt + 1}/${this.#maxRetries}）：${errorName(error)}`,
        );
        await this.#sleeper(delay);
        attempt += 1;
        continue;
      }

      if (!idempotent || !retryableResponse(response) || attempt >= this.#maxRetries) {
        return response;
      }

      const delay = retryDelay(response, attempt);
      this.#warning(`GitHub API 返回 ${response.status}，${delay} 秒后重试（${attempt + 1}/${this.#maxRetries}）。`);
      await this.#sleeper(delay);
      attempt += 1;
    }
  }
}

async function performRequest(request: HttpRequest): Promise<HttpResponse> {
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  };
  if (request.body !== undefined) init.body = request.body;
  const response = await fetch(request.url, init);
  const headers = Object.fromEntries([...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
  return { status: response.status, headers, body: await response.text() };
}

function parseRepository(value: unknown): Repository {
  if (!isRecord(value)) {
    throw new Error("GitHub API 未返回仓库对象。");
  }
  return Object.freeze({
    fullName: String(value.full_name ?? ""),
    archived: value.archived === true,
    disabled: value.disabled === true,
    fork: value.fork === true,
  });
}

function parseLabel(value: unknown): ExistingLabel {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.color !== "string") {
    throw new Error("GitHub API 返回了无效标签对象。");
  }
  const description = value.description;
  if (description !== undefined && description !== null && typeof description !== "string") {
    throw new Error("GitHub API 返回了无效标签描述。");
  }
  return Object.freeze({ name: value.name, color: value.color, description: description ?? null });
}

function githubResponseError(method: string, path: string, response: HttpResponse): Error {
  let message = "GitHub API 返回了非 JSON 错误响应。";
  try {
    const parsed = JSON.parse(response.body) as unknown;
    if (isRecord(parsed) && typeof parsed.message === "string" && parsed.message.length > 0) {
      message = parsed.message
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .slice(0, MAX_ERROR_MESSAGE_LENGTH);
    }
  } catch {
    // Do not expose an unstructured upstream response body in logs or summaries.
  }

  const details = [
    "GitHub API request failed",
    `Method: ${method}`,
    `Path: ${path}`,
    `Status: ${response.status}`,
    `Message: ${message}`,
  ];
  const acceptedPermissions = responseHeader(response, "x-accepted-github-permissions");
  const oauthScopes = responseHeader(response, "x-oauth-scopes");
  if (acceptedPermissions.length > 0) details.push(`Accepted permissions: ${acceptedPermissions}`);
  if (oauthScopes.length > 0) details.push(`Token scopes: ${oauthScopes}`);
  return new Error(details.join("\n"));
}

function retryableResponse(response: HttpResponse): boolean {
  if (response.status === 429 || (response.status >= 500 && response.status <= 599)) return true;
  return response.status === 403 && (
    responseHeader(response, "retry-after").length > 0 ||
    responseHeader(response, "x-ratelimit-remaining") === "0"
  );
}

function retryDelay(response: HttpResponse, attempt: number): number {
  const retryAfter = responseHeader(response, "retry-after");
  if (/^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter), MAX_RETRY_DELAY);

  const resetAt = responseHeader(response, "x-ratelimit-reset");
  if (/^\d+$/.test(resetAt)) {
    return Math.min(Math.max(Number(resetAt) - Math.floor(Date.now() / 1000), 0), MAX_RETRY_DELAY);
  }
  return exponentialBackoff(attempt);
}

function exponentialBackoff(attempt: number): number {
  return Math.min(2 ** attempt, MAX_RETRY_DELAY);
}

function responseHeader(response: HttpResponse, name: string): string {
  const expected = name.toLowerCase();
  const entry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === expected);
  return entry?.[1] ?? "";
}

function isTransientNetworkError(value: unknown): boolean {
  if (!(value instanceof Error)) return false;
  return TRANSIENT_NETWORK_ERROR_NAMES.has(value.name) ||
    TRANSIENT_NETWORK_ERROR_CODES.has(errorCode(value)) ||
    TRANSIENT_NETWORK_ERROR_CODES.has(errorCode(value.cause));
}

function errorCode(value: unknown): string {
  if (typeof value !== "object" || value === null || !("code" in value)) return "";
  return typeof value.code === "string" ? value.code : "";
}

function errorName(value: unknown): string {
  return value instanceof Error ? value.name : "Error";
}

function sleep(delaySeconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
