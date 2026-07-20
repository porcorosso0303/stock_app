import { describe, expect, it, vi } from "vitest";
import {
  TavilyWebTools,
  createFetchHttpTransport,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport
} from "../../src/main/tavily-web-tools";

function response(status: number, body: unknown): HttpResponse {
  return {
    status,
    body: JSON.stringify(body)
  };
}

function harness(nextResponse: HttpResponse = response(200, { results: [] })) {
  const request = vi.fn<(input: HttpRequest) => Promise<HttpResponse>>()
    .mockResolvedValue(nextResponse);
  const key = "tvly-secret-key";
  return {
    key,
    request,
    tools: new TavilyWebTools({ apiKey: key, transport: { request } })
  };
}

describe("TavilyWebTools", () => {
  it("adapts Fetch responses and JSON-encodes request bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      body: null,
      text: async () => "{\"ok\":true}"
    });
    const transport = createFetchHttpTransport(fetchImpl);
    const controller = new AbortController();

    await expect(transport.request({
      url: "https://example.com/api",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { value: 1 },
      signal: controller.signal
    })).resolves.toEqual({ status: 200, body: "{\"ok\":true}" });
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/api", expect.objectContaining({
      method: "POST",
      body: "{\"value\":1}",
      signal: controller.signal
    }));
  });

  it("searches with Bearer authentication and normalized filters", async () => {
    const { tools, request } = harness(response(200, {
      results: [{
        title: "公告",
        url: "https://example.com/a",
        content: "摘要",
        raw_content: "正文",
        score: 0.9,
        published_date: "2026-07-20"
      }]
    }));

    await expect(tools.search({
      query: "兆易创新 财报预告",
      topic: "news",
      days: 2,
      startDate: "2026-07-18",
      endDate: "2026-07-20",
      includeDomains: ["sse.com.cn"],
      excludeDomains: ["spam.example"],
      maxResults: 5
    })).resolves.toEqual([{
      title: "公告",
      url: "https://example.com/a",
      content: "正文",
      score: 0.9,
      publishedAt: "2026-07-20"
    }]);

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://api.tavily.com/search",
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tvly-secret-key" }),
      body: expect.objectContaining({
        query: "兆易创新 财报预告",
        topic: "news",
        days: 2,
        start_date: "2026-07-18",
        end_date: "2026-07-20",
        include_domains: ["sse.com.cn"],
        exclude_domains: ["spam.example"],
        max_results: 5,
        include_raw_content: true
      })
    }));
  });

  it("extracts HTTP pages and reports per-URL failures", async () => {
    const { tools, request } = harness(response(200, {
      results: [{ url: "https://example.com/a", raw_content: "article" }],
      failed_results: [{ url: "https://example.com/b", error: "blocked" }]
    }));

    await expect(tools.extract({
      urls: ["https://example.com/a", "https://example.com/b"]
    })).resolves.toEqual([
      { url: "https://example.com/a", content: "article" },
      { url: "https://example.com/b", errorMessage: "blocked" }
    ]);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://api.tavily.com/extract",
      body: { urls: ["https://example.com/a", "https://example.com/b"] }
    }));
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://example.com/file"
  ])("rejects unsafe extract URL %s", async (url) => {
    const { tools, request } = harness();

    await expect(tools.extract({ urls: [url] })).rejects.toThrow("HTTP");
    expect(request).not.toHaveBeenCalled();
  });

  it("limits URL counts, result counts, and returned content", async () => {
    const { tools } = harness(response(200, {
      results: [{ title: "long", url: "https://example.com", raw_content: "x".repeat(30_000) }]
    }));

    await expect(tools.search({ query: "query", maxResults: 100 })).rejects.toThrow("20");
    await expect(tools.extract({
      urls: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`)
    })).rejects.toThrow("10");
    const results = await tools.search({ query: "query" });
    expect(results[0].content.length).toBeLessThanOrEqual(12_000);
  });

  it.each([
    [401, { detail: "invalid key" }, "Tavily API Key"],
    [429, { detail: "quota exceeded" }, "额度"],
    [500, { detail: "server failed" }, "500"]
  ])("maps Tavily HTTP %s without leaking credentials", async (status, body, message) => {
    const { tools, key } = harness(response(status as number, body));

    const error = await captureError(tools.search({ query: "query" }));

    expect(error.message).toContain(message);
    expect(error.message).not.toContain(key);
    expect(error.message).not.toContain("Bearer");
  });

  it("maps malformed JSON and transport errors without leaking the key", async () => {
    const malformed = harness({ status: 200, body: "{broken" });
    await expect(malformed.tools.search({ query: "query" })).rejects.toThrow("响应格式");

    const request = vi.fn().mockRejectedValue(new Error("connect failed tvly-secret-key"));
    const tools = new TavilyWebTools({
      apiKey: "tvly-secret-key",
      transport: { request } as HttpTransport
    });
    const error = await captureError(tools.search({ query: "query" }));
    expect(error.message).toContain("connect failed");
    expect(error.message).not.toContain("tvly-secret-key");
  });

  it("passes cancellation to the HTTP transport", async () => {
    const request = vi.fn(async (input: HttpRequest) => {
      await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return response(200, {});
    });
    const tools = new TavilyWebTools({ apiKey: "key", transport: { request } });
    const controller = new AbortController();

    const pending = tools.search({ query: "query", signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow("已取消");
  });
});

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
