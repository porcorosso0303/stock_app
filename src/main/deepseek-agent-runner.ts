import type {
  HttpResponse,
  HttpTransport,
  WebExtractInput,
  WebExtractResult,
  WebSearchInput,
  WebSearchResult
} from "./tavily-web-tools";

export interface DeepSeekAgentProgress {
  kind: "status" | "output" | "warning";
  text: string;
}

export interface DeepSeekWebTools {
  search(input: WebSearchInput): Promise<WebSearchResult[]>;
  extract(input: WebExtractInput): Promise<WebExtractResult[]>;
}

export interface DeepSeekAgentRunnerOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  transport: HttpTransport;
  webTools: DeepSeekWebTools;
  onProgress?: (event: DeepSeekAgentProgress) => void;
  maxToolRounds?: number;
  requestTimeoutMs?: number;
}

export interface DeepSeekAgentRequest {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

type DeepSeekMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      reasoning_content?: string;
      tool_calls?: ToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

interface AssistantTurn {
  content: string;
  reasoningContent: string;
  toolCalls: ToolCall[];
}

interface ToolCallAccumulator {
  id: string;
  type: "function";
  name: string;
  arguments: string;
}

const DEFAULT_MAX_TOOL_ROUNDS = 8;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const MAX_VISIBLE_OUTPUT_LENGTH = 1_000_000;
const MAX_TOOL_RESULT_LENGTH = 60_000;

export class DeepSeekAgentRunner {
  private activeController?: AbortController;

  constructor(private readonly options: DeepSeekAgentRunnerOptions) {
    if (!options.apiKey.trim()) throw new Error("DeepSeek API Key 不能为空");
    if (!options.model.trim()) throw new Error("DeepSeek 模型名称不能为空");
  }

  async run(request: DeepSeekAgentRequest): Promise<string> {
    if (this.activeController) {
      throw new Error("DeepSeek 任务已经在运行");
    }
    const controller = new AbortController();
    this.activeController = controller;
    const handleExternalAbort = (): void => controller.abort();
    request.signal?.addEventListener("abort", handleExternalAbort, { once: true });
    if (request.signal?.aborted) controller.abort();

    const messages: DeepSeekMessage[] = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt }
    ];
    const maxToolRounds = this.options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let toolRounds = 0;

    try {
      while (true) {
        this.emit("status", `DeepSeek ${this.options.model} 请求开始`);
        const turn = await this.complete(messages, controller.signal);
        if (turn.content.length > MAX_VISIBLE_OUTPUT_LENGTH) {
          throw new Error("DeepSeek 输出超过允许长度");
        }
        const assistantMessage: Extract<DeepSeekMessage, { role: "assistant" }> = {
          role: "assistant",
          content: turn.content,
          ...(turn.reasoningContent ? { reasoning_content: turn.reasoningContent } : {}),
          ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {})
        };
        messages.push(assistantMessage);

        if (turn.toolCalls.length === 0) {
          if (!turn.content.trim()) throw new Error("DeepSeek 未返回有效内容");
          this.emit("status", "DeepSeek 任务完成");
          return turn.content;
        }
        if (toolRounds >= maxToolRounds) {
          throw new Error(`DeepSeek 工具调用轮数超过限制（${maxToolRounds}）`);
        }
        toolRounds += 1;
        for (const toolCall of turn.toolCalls) {
          this.emit("status", `执行工具 ${toolCall.function.name}`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: await this.executeTool(toolCall, controller.signal)
          });
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("DeepSeek 任务已取消");
      }
      const message = this.redact(error instanceof Error ? error.message : String(error));
      this.emit("warning", message);
      throw new Error(message);
    } finally {
      request.signal?.removeEventListener("abort", handleExternalAbort);
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  cancel(): void {
    this.activeController?.abort();
  }

  private async complete(messages: DeepSeekMessage[], signal: AbortSignal): Promise<AssistantTurn> {
    const response = await this.request({
      model: this.options.model,
      messages: cloneMessages(messages),
      stream: true,
      tools: DEEPSEEK_TOOLS,
      tool_choice: "auto"
    }, signal);
    if (response.status < 200 || response.status >= 300) {
      const body = await readAll(response.body);
      throw new Error(mapDeepSeekHttpError(response.status, body));
    }

    const state = {
      content: "",
      reasoningContent: "",
      toolCalls: new Map<number, ToolCallAccumulator>()
    };
    let reasoningProgressThreshold = 0;
    await readSse(response.body, (payload) => {
      const delta = readDelta(payload);
      if (!delta) return;
      if (typeof delta.content === "string") {
        state.content += delta.content;
        this.emit("output", delta.content);
      }
      if (typeof delta.reasoning_content === "string") {
        state.reasoningContent += delta.reasoning_content;
        if (state.reasoningContent.length >= reasoningProgressThreshold) {
          reasoningProgressThreshold = state.reasoningContent.length + 80;
          this.emit("status", `DeepSeek 思考中（${state.reasoningContent.length} 字）`);
        }
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const rawCall of delta.tool_calls) {
          appendToolCall(state.toolCalls, rawCall);
        }
      }
    });
    return {
      content: state.content,
      reasoningContent: state.reasoningContent,
      toolCalls: [...state.toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call], index) => ({
          id: call.id || `tool-call-${index + 1}`,
          type: "function",
          function: { name: call.name, arguments: call.arguments }
        }))
    };
  }

  private async request(body: unknown, signal: AbortSignal): Promise<HttpResponse> {
    const controller = new AbortController();
    const handleAbort = (): void => controller.abort();
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      return await this.options.transport.request({
        url: `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json"
        },
        body,
        signal: controller.signal
      });
    } catch (error) {
      if (signal.aborted) throw new Error("DeepSeek 任务已取消");
      if (controller.signal.aborted) throw new Error("DeepSeek 请求超时");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
    }
  }

  private async executeTool(toolCall: ToolCall, signal: AbortSignal): Promise<string> {
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(toolCall.function.arguments) as unknown;
      if (!isRecord(parsed)) throw new Error("参数必须是 JSON 对象");
      args = parsed;
    } catch (error) {
      return toolError("invalid_tool_arguments", error instanceof Error ? error.message : String(error));
    }

    try {
      if (toolCall.function.name === "web_search") {
        const results = await this.options.webTools.search(readSearchInput(args, signal));
        this.emit("status", `web_search 返回 ${results.length} 条结果`);
        return truncateToolResult(JSON.stringify({ ok: true, results }));
      }
      if (toolCall.function.name === "web_extract") {
        const results = await this.options.webTools.extract(readExtractInput(args, signal));
        this.emit("status", `web_extract 返回 ${results.length} 条结果`);
        return truncateToolResult(JSON.stringify({ ok: true, results }));
      }
      return toolError("unknown_tool", `不支持的工具：${toolCall.function.name}`);
    } catch (error) {
      const message = this.redact(error instanceof Error ? error.message : String(error));
      this.emit("warning", `${toolCall.function.name} 失败：${message}`);
      return toolError("tool_execution_failed", message);
    }
  }

  private emit(kind: DeepSeekAgentProgress["kind"], text: string): void {
    this.options.onProgress?.({ kind, text: this.redact(text) });
  }

  private redact(value: string): string {
    return value.split(this.options.apiKey).join("[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  }
}

const DEEPSEEK_TOOLS = [{
  type: "function",
  function: {
    name: "web_search",
    description: "Search current web sources with Tavily.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        topic: { type: "string", enum: ["general", "news", "finance"] },
        days: { type: "integer", minimum: 1 },
        start_date: { type: "string" },
        end_date: { type: "string" },
        include_domains: { type: "array", items: { type: "string" } },
        exclude_domains: { type: "array", items: { type: "string" } },
        max_results: { type: "integer", minimum: 1, maximum: 20 }
      },
      required: ["query"]
    }
  }
}, {
  type: "function",
  function: {
    name: "web_extract",
    description: "Extract full text from HTTP or HTTPS pages returned by search.",
    parameters: {
      type: "object",
      properties: {
        urls: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } }
      },
      required: ["urls"]
    }
  }
}];

async function readSse(
  body: HttpResponse["body"],
  onPayload: (payload: unknown) => void
): Promise<void> {
  let buffer = "";
  const consume = (text: string, final = false): void => {
    buffer += text.replace(/\r\n/g, "\n");
    const blocks = buffer.split("\n\n");
    buffer = final ? "" : blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        onPayload(JSON.parse(data) as unknown);
      } catch {
        throw new Error("DeepSeek 流式响应格式错误");
      }
    }
  };

  if (typeof body === "string") {
    consume(body);
    consume("\n\n", true);
    return;
  }
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    consume(decoder.decode(chunk, { stream: true }));
  }
  consume(decoder.decode() + "\n\n", true);
}

function readDelta(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;
  const choice = payload.choices[0];
  return isRecord(choice) && isRecord(choice.delta) ? choice.delta : undefined;
}

function appendToolCall(target: Map<number, ToolCallAccumulator>, raw: unknown): void {
  if (!isRecord(raw)) return;
  const index = typeof raw.index === "number" ? raw.index : 0;
  const existing = target.get(index) ?? { id: "", type: "function" as const, name: "", arguments: "" };
  if (typeof raw.id === "string") existing.id = raw.id;
  const fn = isRecord(raw.function) ? raw.function : undefined;
  if (typeof fn?.name === "string") existing.name += fn.name;
  if (typeof fn?.arguments === "string") existing.arguments += fn.arguments;
  target.set(index, existing);
}

function readSearchInput(args: Record<string, unknown>, signal: AbortSignal): WebSearchInput {
  if (typeof args.query !== "string" || !args.query.trim()) throw new Error("web_search.query 不能为空");
  const topic = args.topic;
  if (topic !== undefined && topic !== "general" && topic !== "news" && topic !== "finance") {
    throw new Error("web_search.topic 无效");
  }
  return {
    query: args.query,
    ...(topic ? { topic } : {}),
    ...(typeof args.days === "number" ? { days: args.days } : {}),
    ...(typeof args.start_date === "string" ? { startDate: args.start_date } : {}),
    ...(typeof args.end_date === "string" ? { endDate: args.end_date } : {}),
    ...(Array.isArray(args.include_domains) ? { includeDomains: requireStringArray(args.include_domains) } : {}),
    ...(Array.isArray(args.exclude_domains) ? { excludeDomains: requireStringArray(args.exclude_domains) } : {}),
    ...(typeof args.max_results === "number" ? { maxResults: args.max_results } : {}),
    signal
  };
}

function readExtractInput(args: Record<string, unknown>, signal: AbortSignal): WebExtractInput {
  if (!Array.isArray(args.urls)) throw new Error("web_extract.urls 必须是数组");
  return { urls: requireStringArray(args.urls), signal };
}

function requireStringArray(value: unknown[]): string[] {
  if (!value.every((item) => typeof item === "string")) throw new Error("工具数组参数必须全部是字符串");
  return value as string[];
}

function toolError(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message } });
}

function truncateToolResult(value: string): string {
  return value.slice(0, MAX_TOOL_RESULT_LENGTH);
}

async function readAll(body: HttpResponse["body"]): Promise<string> {
  if (typeof body === "string") return body;
  const decoder = new TextDecoder();
  let value = "";
  for await (const chunk of body) value += decoder.decode(chunk, { stream: true });
  return value + decoder.decode();
}

function mapDeepSeekHttpError(status: number, body: string): string {
  if (status === 401 || status === 403) return "DeepSeek API Key 无效或没有访问权限";
  if (status === 402) return "DeepSeek 账户余额不足";
  const detail = readDeepSeekError(body);
  if (status === 404 || /model.+(?:not found|不存在)/i.test(detail)) {
    return `DeepSeek 模型不存在，请检查模型名称${detail ? `：${detail}` : ""}`;
  }
  return `DeepSeek 请求失败（HTTP ${status}）${detail ? `：${detail}` : ""}`;
}

function readDeepSeekError(body: string): string {
  try {
    const value = JSON.parse(body) as unknown;
    if (!isRecord(value)) return "";
    if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
    return typeof value.message === "string" ? value.message : "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneMessages(messages: DeepSeekMessage[]): DeepSeekMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.tool_calls) {
      return { ...message };
    }
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => ({
        ...call,
        function: { ...call.function }
      }))
    };
  });
}
