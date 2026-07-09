import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CodexEnvironmentStatus, CodexLauncher } from "../shared/types";
import type { CodexRunResult } from "./codex-runner";
import type { WatchNewsDraft } from "./watch-news-store";

export interface WatchNewsStockInput {
  secid: string;
  stockName: string;
  existingMessages: Array<{
    title: string;
    sourceUrl?: string;
    fetchedAt: string;
  }>;
}

export interface WatchNewsAnalysisProvider {
  analyze(stock: WatchNewsStockInput): Promise<WatchNewsDraft[]>;
}

interface CodexLocatorLike {
  detect(): Promise<CodexEnvironmentStatus>;
}

interface CodexRunnerLike {
  run(prompt: string): Promise<CodexRunResult>;
  cancel(): void;
}

interface RunnerOptions {
  launcher: CodexLauncher;
  runDirectory: string;
  onEvent: (text: string) => void;
}

export interface CodexWatchNewsAnalysisProviderDependencies {
  codexLocator: CodexLocatorLike;
  createRunner: (options: RunnerOptions) => CodexRunnerLike;
  userDataDirectory: string;
  now?: () => Date;
}

export class CodexWatchNewsAnalysisProvider implements WatchNewsAnalysisProvider {
  private activeRunners = new Set<CodexRunnerLike>();
  private readonly now: () => Date;

  constructor(private readonly dependencies: CodexWatchNewsAnalysisProviderDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async analyze(stock: WatchNewsStockInput): Promise<WatchNewsDraft[]> {
    const codex = await this.dependencies.codexLocator.detect();
    const launcher = requireCodexLauncher(codex);
    const runDirectory = join(
      this.dependencies.userDataDirectory,
      "watch-news-runs",
      `${formatRunTimestamp(this.now())}-${sanitizeFilePart(stock.secid)}`
    );
    await mkdir(runDirectory, { recursive: true });
    const runner = this.dependencies.createRunner({
      launcher,
      runDirectory,
      onEvent: () => undefined
    });
    this.activeRunners.add(runner);
    try {
      const result = await runner.run(buildWatchNewsPrompt(stock, this.now()));
      if (result.status === "cancelled") {
        return [];
      }
      if (result.status === "failed") {
        throw new Error(result.errorMessage);
      }
      return parseWatchNewsDrafts(result.reportMarkdown, stock);
    } finally {
      this.activeRunners.delete(runner);
    }
  }

  cancelAll(): void {
    for (const runner of this.activeRunners) {
      runner.cancel();
    }
  }
}

function buildWatchNewsPrompt(stock: WatchNewsStockInput, now: Date): string {
  const code = stock.secid.split(".")[1] ?? stock.secid;
  const exchange = stock.secid.startsWith("1.") ? "沪市" : "深市";
  const xueqiuPrefix = stock.secid.startsWith("1.") ? "SH" : "SZ";
  const existing = stock.existingMessages.slice(0, 20)
    .map((message) => `- ${message.fetchedAt} ${message.title}${message.sourceUrl ? ` ${message.sourceUrl}` : ""}`)
    .join("\n") || "无";
  return [
    "你是 A 股持仓股消息面监控助手。请联网检索并分析指定股票最近 48 小时内的消息。",
    "只关注可能影响公司业绩、基本面、订单、监管、财报、股价走势或市场预期的消息；普通噪音、重复转载、没有事实源的情绪贴不要输出。",
    "",
    `当前时间：${now.toISOString()}`,
    `股票：${stock.stockName}`,
    `secid：${stock.secid}`,
    `代码：${code}`,
    `交易所：${exchange}`,
    "",
    "必须检查的来源范围：",
    "1. 公司官方网站最近 48 小时发布的信息。",
    "2. 权威互动平台：沪市使用上证 e 互动 http://sns.sseinfo.com/；深市使用深交所互动易 https://irm.cninfo.com.cn/。",
    "3. 官方投资者交流问答内容，时间范围 48 小时内。",
    "4. 媒体：东方财富、澎湃、界面新闻、科创板日报，时间范围 48 小时内。",
    `5. 雪球论坛当天交易日帖子：https://xueqiu.com/S/${xueqiuPrefix}${code}。如果雪球帖子提到可能影响走势的消息，必须尝试到权威渠道查证；没有被证伪且有合理依据时才输出，并标明可信度。`,
    "",
    "历史已收录消息，输出前必须去重：",
    existing,
    "",
    "输出要求：",
    "只输出 JSON，不要输出 Markdown 解释。JSON 格式为数组，每个元素包含：",
    "{",
    '  "title": "消息标题",',
    '  "summary": "不超过120字的事实摘要",',
    '  "sourceName": "来源名称",',
    '  "sourceUrl": "来源链接，可为空",',
    '  "occurredAt": "消息发布时间或事件时间，ISO字符串或原文日期，可为空",',
    '  "analysis": "对业绩或股价可能影响的分析意见，说明偏利好/偏利空/中性和原因",',
    '  "confidence": "high|medium|low"',
    "}",
    "如果没有新的有效消息，输出 []。"
  ].join("\n");
}

function parseWatchNewsDrafts(markdown: string, stock: WatchNewsStockInput): WatchNewsDraft[] {
  const value = JSON.parse(extractJson(markdown)) as unknown;
  if (!Array.isArray(value)) {
    throw new Error("持仓股消息模型输出不是 JSON 数组");
  }
  return value.flatMap((item): WatchNewsDraft[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const title = readString(record.title);
    const summary = readString(record.summary);
    const sourceName = readString(record.sourceName);
    const analysis = readString(record.analysis);
    if (!title || !summary || !sourceName || !analysis) {
      return [];
    }
    return [{
      secid: stock.secid,
      stockName: stock.stockName,
      title,
      summary,
      sourceName,
      sourceUrl: readString(record.sourceUrl),
      occurredAt: readString(record.occurredAt),
      analysis,
      confidence: record.confidence === "high" || record.confidence === "low" ? record.confidence : "medium"
    }];
  });
}

function extractJson(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    return trimmed;
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]?.trim().startsWith("[")) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  throw new Error("持仓股消息模型输出缺少 JSON 数组");
}

function requireCodexLauncher(status: CodexEnvironmentStatus): CodexLauncher {
  if (!status.available || !status.launcher) {
    throw new Error(status.message ?? "GPT/Codex 消息分析通道不可用");
  }
  if (status.loggedIn === false) {
    throw new Error(status.message ?? "GPT/Codex 消息分析通道尚未登录，请先完成登录。");
  }
  return status.launcher;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatRunTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
