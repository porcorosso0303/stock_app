import { describe, expect, it, vi } from "vitest";
import {
  DeepSeekAgentRunner,
  type DeepSeekAgentProgress
} from "../../src/main/deepseek-agent-runner";
import type {
  HttpRequest,
  HttpResponse,
  WebExtractInput,
  WebSearchInput
} from "../../src/main/tavily-web-tools";

function sse(events: unknown[]): HttpResponse {
  return {
    status: 200,
    body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`
  };
}

function contentResponse(content: string): HttpResponse {
  return sse([{ choices: [{ delta: { content } }] }]);
}

function createHarness(responses: HttpResponse[], options: {
  maxToolRounds?: number;
  requireSuccessfulWebTool?: boolean;
} = {}) {
  const requests: HttpRequest[] = [];
  const request = vi.fn(async (input: HttpRequest) => {
    requests.push(input);
    const response = responses.shift();
    if (!response) throw new Error("No scripted response");
    return response;
  });
  const search = vi.fn(async (_input: WebSearchInput) => [{
    title: "公告",
    url: "https://example.com/notice",
    content: "公告正文"
  }]);
  const extract = vi.fn(async (_input: WebExtractInput) => [{
    url: "https://example.com/notice",
    content: "完整公告"
  }]);
  const progress: DeepSeekAgentProgress[] = [];
  const apiKey = "deepseek-secret-key";
  const runner = new DeepSeekAgentRunner({
    apiKey,
    baseUrl: "https://api.deepseek.com/",
    model: "deepseek-v4-pro",
    transport: { request },
    webTools: { search, extract },
    onProgress: (event) => progress.push(event),
    ...options
  });
  return { runner, request, requests, search, extract, progress, apiKey };
}

describe("DeepSeekAgentRunner", () => {
  it("sends a streaming tool-enabled chat completion request", async () => {
    const { runner, requests } = createHarness([contentResponse("# 调研报告")]);

    await expect(runner.run({
      systemPrompt: "system rules",
      userPrompt: "research stock"
    })).resolves.toBe("# 调研报告");

    expect(requests[0]).toMatchObject({
      url: "https://api.deepseek.com/chat/completions",
      method: "POST",
      headers: { Authorization: "Bearer deepseek-secret-key" },
      body: {
        model: "deepseek-v4-pro",
        stream: true,
        tool_choice: "auto",
        messages: [
          { role: "system", content: "system rules" },
          { role: "user", content: "research stock" }
        ]
      }
    });
    expect((requests[0].body as { tools: unknown[] }).tools).toHaveLength(2);
  });

  it("combines split tool arguments and replays reasoning content on the next turn", async () => {
    const toolTurn = sse([
      { choices: [{ delta: {
        reasoning_content: "需要检索",
        tool_calls: [{
          index: 0,
          id: "call-search",
          type: "function",
          function: { name: "web_search", arguments: "{\"query\":\"兆易" }
        }]
      } }] },
      { choices: [{ delta: {
        tool_calls: [{ index: 0, function: { arguments: "创新 财报\",\"topic\":\"news\"}" } }]
      } }] }
    ]);
    const { runner, requests, search } = createHarness([
      toolTurn,
      contentResponse("最终结论")
    ]);

    await expect(runner.run({ systemPrompt: "s", userPrompt: "u" })).resolves.toBe("最终结论");

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      query: "兆易创新 财报",
      topic: "news"
    }));
    const secondBody = requests[1].body as { messages: Array<Record<string, unknown>> };
    expect(secondBody.messages[2]).toEqual({
      role: "assistant",
      content: "",
      reasoning_content: "需要检索",
      tool_calls: [{
        id: "call-search",
        type: "function",
        function: {
          name: "web_search",
          arguments: "{\"query\":\"兆易创新 财报\",\"topic\":\"news\"}"
        }
      }]
    });
    expect(secondBody.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "call-search"
    });
  });

  it("returns invalid tool arguments to the model as a structured tool error", async () => {
    const toolTurn = sse([{ choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "bad-call",
      type: "function",
      function: { name: "web_extract", arguments: "not-json" }
    }] } }] }]);
    const { runner, requests, extract } = createHarness([toolTurn, contentResponse("已修正")]);

    await expect(runner.run({ systemPrompt: "s", userPrompt: "u" })).resolves.toBe("已修正");

    expect(extract).not.toHaveBeenCalled();
    const messages = (requests[1].body as { messages: Array<Record<string, unknown>> }).messages;
    expect(messages[3].content).toContain("invalid_tool_arguments");
  });

  it("maps DeepSeek API errors to actionable Chinese messages", async () => {
    const cases: Array<[number, unknown, string]> = [
      [401, { error: { message: "invalid api key" } }, "API Key"],
      [402, { error: { message: "insufficient balance" } }, "余额"],
      [404, { error: { message: "model not found" } }, "模型"],
      [500, { error: { message: "server error" } }, "500"]
    ];
    for (const [status, body, message] of cases) {
      const { runner } = createHarness([{ status, body: JSON.stringify(body) }]);
      await expect(runner.run({ systemPrompt: "s", userPrompt: "u" })).rejects.toThrow(message);
    }
  });

  it("redacts credentials from progress and transport errors", async () => {
    const key = "deepseek-secret-key";
    const request = vi.fn().mockRejectedValue(new Error(`connect failed ${key} Bearer ${key}`));
    const progress: DeepSeekAgentProgress[] = [];
    const runner = new DeepSeekAgentRunner({
      apiKey: key,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      transport: { request },
      webTools: { search: vi.fn(), extract: vi.fn() },
      onProgress: (event) => progress.push(event)
    });

    const error = await captureError(runner.run({ systemPrompt: "s", userPrompt: "u" }));

    expect(error.message).not.toContain(key);
    expect(JSON.stringify(progress)).not.toContain(key);
  });

  it("cancels an in-flight HTTP request", async () => {
    const request = vi.fn(async (input: HttpRequest): Promise<HttpResponse> => {
      await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return contentResponse("never");
    });
    const runner = new DeepSeekAgentRunner({
      apiKey: "key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      transport: { request },
      webTools: { search: vi.fn(), extract: vi.fn() }
    });

    const pending = runner.run({ systemPrompt: "s", userPrompt: "u" });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    runner.cancel();

    await expect(pending).rejects.toThrow("已取消");
  });

  it("keeps cancellation connected while reading the streaming response body", async () => {
    let streamStarted = false;
    const request = vi.fn(async (input: HttpRequest): Promise<HttpResponse> => ({
      status: 200,
      body: {
        async *[Symbol.asyncIterator]() {
          streamStarted = true;
          await new Promise<void>((_resolve, reject) => {
            if (input.signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
      }
    }));
    const runner = new DeepSeekAgentRunner({
      apiKey: "key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      transport: { request },
      webTools: { search: vi.fn(), extract: vi.fn() }
    });

    const pending = runner.run({ systemPrompt: "s", userPrompt: "u" });
    const outcome = pending.then(
      () => "resolved",
      (error: Error) => error.message
    );
    await vi.waitFor(() => expect(streamStarted).toBe(true));
    runner.cancel();

    await expect(Promise.race([
      outcome,
      new Promise<string>((resolve) => setTimeout(() => resolve("still pending"), 100))
    ])).resolves.toContain("已取消");
  });

  it("stops an unbounded sequence of tool calls", async () => {
    const toolTurn = sse([{ choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "call",
      type: "function",
      function: { name: "web_search", arguments: "{\"query\":\"q\"}" }
    }] } }] }]);
    const { runner } = createHarness([toolTurn, toolTurn], { maxToolRounds: 1 });

    await expect(runner.run({ systemPrompt: "s", userPrompt: "u" })).rejects.toThrow("工具调用轮数");
  });

  it("emits model and tool progress without exposing reasoning as final output", async () => {
    const toolTurn = sse([
      { choices: [{ delta: { reasoning_content: "内部" } }] },
      { choices: [{ delta: {
      reasoning_content: "思考",
      tool_calls: [{
        index: 0,
        id: "call",
        type: "function",
        function: { name: "web_search", arguments: "{\"query\":\"公告\"}" }
      }]
    } }] }]);
    const { runner, progress } = createHarness([toolTurn, contentResponse("公开结论")]);

    await runner.run({ systemPrompt: "s", userPrompt: "u" });

    expect(progress.some((event) => event.text.includes("deepseek-v4-pro"))).toBe(true);
    expect(progress.some((event) => event.text.includes("web_search"))).toBe(true);
    expect(progress.some((event) => event.text.includes("思考中"))).toBe(false);
    expect(progress.filter((event) => event.kind === "reasoning").map((event) => event.text).join(""))
      .toBe("内部思考");
    expect(progress.filter((event) => event.kind === "output").map((event) => event.text).join(""))
      .toBe("公开结论");
  });

  it("rejects an evidence task when no web tool succeeds", async () => {
    const { runner } = createHarness([contentResponse("没有检索依据的结论")], {
      requireSuccessfulWebTool: true
    });

    await expect(runner.run({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toThrow("网页检索");
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
