export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  signal: AbortSignal;
}

export interface HttpResponse {
  status: number;
  body: string | AsyncIterable<Uint8Array>;
}

export interface HttpTransport {
  request(input: HttpRequest): Promise<HttpResponse>;
}

interface FetchResponseLike {
  status: number;
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      releaseLock?(): void;
    };
  } | null;
  text(): Promise<string>;
}

type HttpFetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  }
) => Promise<FetchResponseLike>;

export function createFetchHttpTransport(fetchImpl: HttpFetchLike): HttpTransport {
  return {
    request: async (input) => {
      const response = await fetchImpl(input.url, {
        method: input.method,
        headers: input.headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: input.signal
      });
      return {
        status: response.status,
        body: response.body ? readFetchStream(response.body) : await response.text()
      };
    }
  };
}

export interface WebSearchInput {
  query: string;
  topic?: "general" | "news" | "finance";
  days?: number;
  startDate?: string;
  endDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  maxResults?: number;
  signal?: AbortSignal;
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedAt?: string;
}

export interface WebExtractInput {
  urls: string[];
  signal?: AbortSignal;
}

export interface WebExtractResult {
  url: string;
  content?: string;
  errorMessage?: string;
}

export interface TavilyWebToolsOptions {
  apiKey: string;
  transport: HttpTransport;
  baseUrl?: string;
  requestTimeoutMs?: number;
}

const MAX_RESULTS = 20;
const MAX_EXTRACT_URLS = 10;
const MAX_CONTENT_LENGTH = 12_000;

export class TavilyWebTools {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: TavilyWebToolsOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("Tavily API Key 不能为空");
    }
    this.baseUrl = (options.baseUrl ?? "https://api.tavily.com").replace(/\/+$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async search(input: WebSearchInput): Promise<WebSearchResult[]> {
    const query = input.query.trim();
    if (!query) {
      throw new Error("Tavily 搜索关键词不能为空");
    }
    const maxResults = input.maxResults ?? 10;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
      throw new Error(`Tavily 搜索结果数量必须在 1 到 ${MAX_RESULTS} 之间`);
    }

    const body = compactObject({
      query,
      topic: input.topic,
      days: input.days,
      start_date: input.startDate,
      end_date: input.endDate,
      include_domains: normalizeDomains(input.includeDomains),
      exclude_domains: normalizeDomains(input.excludeDomains),
      max_results: maxResults,
      include_raw_content: true
    });
    const response = await this.request("/search", body, input.signal);
    const data = requireObject(response, "Tavily 搜索响应格式错误");
    if (!Array.isArray(data.results)) {
      return [];
    }
    return data.results.flatMap((value) => {
      if (!isRecord(value)) return [];
      const title = readString(value.title);
      const url = readHttpUrl(value.url);
      if (!title || !url) return [];
      const content = truncate(readString(value.raw_content) || readString(value.content));
      return [{
        title,
        url,
        content,
        ...(typeof value.score === "number" ? { score: value.score } : {}),
        ...(readString(value.published_date)
          ? { publishedAt: readString(value.published_date) }
          : {})
      }];
    });
  }

  async extract(input: WebExtractInput): Promise<WebExtractResult[]> {
    if (!Array.isArray(input.urls) || input.urls.length === 0) {
      throw new Error("Tavily 正文提取至少需要一个 URL");
    }
    if (input.urls.length > MAX_EXTRACT_URLS) {
      throw new Error(`Tavily 单次正文提取最多支持 ${MAX_EXTRACT_URLS} 个 URL`);
    }
    const urls = input.urls.map(requireHttpUrl);
    const response = await this.request("/extract", { urls }, input.signal);
    const data = requireObject(response, "Tavily 正文提取响应格式错误");
    const results: WebExtractResult[] = [];
    if (Array.isArray(data.results)) {
      for (const value of data.results) {
        if (!isRecord(value)) continue;
        const url = readHttpUrl(value.url);
        if (!url) continue;
        results.push({ url, content: truncate(readString(value.raw_content) || readString(value.content)) });
      }
    }
    if (Array.isArray(data.failed_results)) {
      for (const value of data.failed_results) {
        if (!isRecord(value)) continue;
        const url = readHttpUrl(value.url);
        if (!url) continue;
        results.push({ url, errorMessage: readString(value.error) || "正文提取失败" });
      }
    }
    return results;
  }

  private async request(path: string, body: unknown, externalSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const handleExternalAbort = (): void => controller.abort();
    externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      const response = await this.options.transport.request({
        url: `${this.baseUrl}${path}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json"
        },
        body,
        signal: controller.signal
      });
      const text = await readResponseBody(response.body);
      const parsed = parseJson(text);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(mapHttpError(response.status, parsed));
      }
      return parsed;
    } catch (error) {
      if (externalSignal?.aborted) {
        throw new Error("Tavily 请求已取消");
      }
      if (timedOut) {
        throw new Error("Tavily 请求超时");
      }
      throw new Error(this.redact(error instanceof Error ? error.message : String(error)));
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", handleExternalAbort);
    }
  }

  private redact(value: string): string {
    return value.split(this.options.apiKey).join("[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  }
}

function mapHttpError(status: number, body: unknown): string {
  if (status === 401 || status === 403) {
    return "Tavily API Key 无效或没有访问权限";
  }
  if (status === 429) {
    return "Tavily 检索额度不足或请求过于频繁";
  }
  const detail = isRecord(body)
    ? readString(body.detail) || readString(body.message)
    : "";
  return `Tavily 请求失败（HTTP ${status}）${detail ? `：${detail}` : ""}`;
}

async function readResponseBody(body: HttpResponse["body"]): Promise<string> {
  if (typeof body === "string") return body;
  const decoder = new TextDecoder();
  let result = "";
  for await (const chunk of body) {
    result += decoder.decode(chunk, { stream: true });
  }
  return result + decoder.decode();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Tavily 响应格式错误：无法解析 JSON");
  }
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function normalizeDomains(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const domains = [...new Set(value.map((domain) => domain.trim()).filter(Boolean))];
  if (domains.length > 20) throw new Error("Tavily 域名过滤最多支持 20 项");
  return domains;
}

function requireHttpUrl(value: string): string {
  const url = readHttpUrl(value);
  if (!url) throw new Error("正文提取 URL 必须使用 HTTP 或 HTTPS");
  return url;
}

function readHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function truncate(value: string): string {
  return value.slice(0, MAX_CONTENT_LENGTH);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function* readFetchStream(stream: NonNullable<FetchResponseLike["body"]>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      if (result.value) yield result.value;
    }
  } finally {
    reader.releaseLock?.();
  }
}
