import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CodexEnvironmentStatus,
  CodexLauncher,
  WatchNewsDebugEvent,
  WatchNewsDebugRun
} from "../shared/types";
import type { CodexRunResult } from "./codex-runner";
import { CodexJsonlParser } from "./codex-events";
import type { WatchNewsDraft } from "./watch-news-store";
import type { FetchLike } from "./east-money-quote-service";

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
  analyze(
    stock: WatchNewsStockInput,
    onPartialDrafts?: (drafts: WatchNewsDraft[]) => Promise<void>
  ): Promise<WatchNewsDraft[]>;
  getLatestDebugRun?(secid?: string): Promise<WatchNewsDebugRun | undefined>;
}

export interface WatchNewsNoticeCandidate {
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl?: string;
  occurredAt?: string;
}

export interface WatchNewsNoticeSource {
  listRecent(
    stock: WatchNewsStockInput,
    now: Date,
    lookbackHours: number
  ): Promise<WatchNewsNoticeCandidate[]>;
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
  idleTimeoutMs?: number;
  maxRuntimeMs?: number;
}

export interface CodexWatchNewsAnalysisProviderDependencies {
  codexLocator: CodexLocatorLike;
  createRunner: (options: RunnerOptions) => CodexRunnerLike;
  userDataDirectory: string;
  noticeSource?: WatchNewsNoticeSource;
  now?: () => Date;
}

export class CodexWatchNewsAnalysisProvider implements WatchNewsAnalysisProvider {
  private activeRunners = new Set<CodexRunnerLike>();
  private readonly now: () => Date;

  constructor(private readonly dependencies: CodexWatchNewsAnalysisProviderDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async analyze(
    stock: WatchNewsStockInput,
    onPartialDrafts?: (drafts: WatchNewsDraft[]) => Promise<void>
  ): Promise<WatchNewsDraft[]> {
    const now = this.now();
    const lookbackHours = stock.existingMessages.length === 0 ? 7 * 24 : 48;
    const { candidates, errorMessage: noticeErrorMessage } = await this.listNoticeCandidates(
      stock,
      now,
      lookbackHours
    );
    const fallbackDrafts = candidates.flatMap((candidate) =>
      isMaterialNotice(candidate) ? [buildNoticeFallbackDraft(stock, candidate)] : []
    );
    if (fallbackDrafts.length > 0) {
      await onPartialDrafts?.(fallbackDrafts);
    }
    const runDirectory = join(
      this.dependencies.userDataDirectory,
      "watch-news-runs",
      `${formatRunTimestamp(now)}-${sanitizeFilePart(stock.secid)}`
    );
    await mkdir(runDirectory, { recursive: true });
    const prompt = buildWatchNewsPrompt(
      stock,
      now,
      candidates,
      noticeErrorMessage,
      lookbackHours
    );
    await writeFile(join(runDirectory, "prompt.txt"), prompt, "utf8");
    await this.writeRunMeta(runDirectory, {
      secid: stock.secid,
      stockName: stock.stockName,
      createdAt: now.toISOString()
    });
    let launcher: CodexLauncher;
    try {
      launcher = requireCodexLauncher(await this.dependencies.codexLocator.detect());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.writeRunMeta(runDirectory, {
        secid: stock.secid,
        stockName: stock.stockName,
        createdAt: now.toISOString(),
        errorMessage
      });
      if (fallbackDrafts.length > 0) {
        return fallbackDrafts;
      }
      throw error;
    }
    const runner = this.dependencies.createRunner({
      launcher,
      runDirectory,
      onEvent: () => undefined,
      idleTimeoutMs: 180_000,
      maxRuntimeMs: 720_000
    });
    this.activeRunners.add(runner);
    try {
      const result = await runner.run(prompt);
      if (result.status === "cancelled") {
        await this.writeRunMeta(runDirectory, {
          secid: stock.secid,
          stockName: stock.stockName,
          createdAt: now.toISOString(),
          errorMessage: "用户取消"
        });
        return fallbackDrafts;
      }
      if (result.status === "failed") {
        await this.writeRunMeta(runDirectory, {
          secid: stock.secid,
          stockName: stock.stockName,
          createdAt: now.toISOString(),
          errorMessage: result.errorMessage
        });
        if (fallbackDrafts.length > 0) {
          return fallbackDrafts;
        }
        throw new Error(result.errorMessage);
      }
      try {
        const modelDrafts = parseWatchNewsDrafts(result.reportMarkdown, stock);
        await this.writeRunMeta(runDirectory, {
          secid: stock.secid,
          stockName: stock.stockName,
          createdAt: now.toISOString()
        });
        return mergeWatchNewsDrafts(modelDrafts, fallbackDrafts);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.writeRunMeta(runDirectory, {
          secid: stock.secid,
          stockName: stock.stockName,
          createdAt: now.toISOString(),
          errorMessage
        });
        if (fallbackDrafts.length > 0) {
          return fallbackDrafts;
        }
        throw error;
      }
    } finally {
      this.activeRunners.delete(runner);
    }
  }

  async getLatestDebugRun(secid?: string): Promise<WatchNewsDebugRun | undefined> {
    const runsDirectory = join(this.dependencies.userDataDirectory, "watch-news-runs");
    let entries: string[];
    try {
      entries = await readdir(runsDirectory);
    } catch {
      return undefined;
    }
    const matching = entries
      .filter((entry) => !secid || entry.endsWith(`-${sanitizeFilePart(secid)}`))
      .sort((left, right) => right.localeCompare(left));
    for (const entry of matching) {
      const runDirectory = join(runsDirectory, entry);
      const meta = await readRunMeta(runDirectory);
      if (secid && meta?.secid !== secid && !entry.endsWith(`-${sanitizeFilePart(secid)}`)) {
        continue;
      }
      const prompt = await readOptionalFile(join(runDirectory, "prompt.txt"));
      const eventsRaw = await readOptionalFile(join(runDirectory, "events.jsonl"));
      const stderr = await readOptionalFile(join(runDirectory, "stderr.log"));
      const reportMarkdown = await readOptionalFile(join(runDirectory, "report.md"));
      return {
        runId: entry,
        runDirectory,
        secid: meta?.secid ?? secid ?? "",
        stockName: meta?.stockName,
        createdAt: meta?.createdAt ?? parseCreatedAtFromRunId(entry),
        prompt,
        events: parseDebugEvents(eventsRaw),
        stderr,
        reportMarkdown,
        errorMessage: meta?.errorMessage
      };
    }
    return undefined;
  }

  cancelAll(): void {
    for (const runner of this.activeRunners) {
      runner.cancel();
    }
  }

  private async listNoticeCandidates(
    stock: WatchNewsStockInput,
    now: Date,
    lookbackHours: number
  ): Promise<{ candidates: WatchNewsNoticeCandidate[]; errorMessage?: string }> {
    if (!this.dependencies.noticeSource) {
      return { candidates: [] };
    }
    try {
      return {
        candidates: await this.dependencies.noticeSource.listRecent(stock, now, lookbackHours)
      };
    } catch (error) {
      return {
        candidates: [],
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async writeRunMeta(
    runDirectory: string,
    meta: {
      secid: string;
      stockName: string;
      createdAt: string;
      errorMessage?: string;
    }
  ): Promise<void> {
    await writeFile(join(runDirectory, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }
}

export class EastMoneyWatchNewsNoticeSource implements WatchNewsNoticeSource {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async listRecent(
    stock: WatchNewsStockInput,
    now: Date,
    lookbackHours = 48
  ): Promise<WatchNewsNoticeCandidate[]> {
    const code = stock.secid.split(".")[1] ?? stock.secid;
    const url = new URL("https://np-anotice-stock.eastmoney.com/api/security/ann");
    url.searchParams.set("sr", "-1");
    url.searchParams.set("page_size", "20");
    url.searchParams.set("page_index", "1");
    url.searchParams.set("ann_type", "A");
    url.searchParams.set("client_source", "web");
    url.searchParams.set("stock_list", code);
    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error("东方财富公告请求失败");
    }
    return readEastMoneyNoticeCandidates(await response.json(), stock, now, lookbackHours);
  }
}

function buildWatchNewsPrompt(
  stock: WatchNewsStockInput,
  now: Date,
  noticeCandidates: WatchNewsNoticeCandidate[],
  noticeErrorMessage: string | undefined,
  lookbackHours: number
): string {
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
    `本次公告候选回看窗口：${lookbackHours} 小时。联网搜索仍只检查最近 48 小时；首次无历史记录时，公告候选允许回补最近 7 天，避免恢复此前失败任务时永久漏报。`,
    "",
    "必须检查的来源范围：",
    "1. 交易所公告/法定信息披露公告：优先检查上交所或深交所公告、巨潮资讯、东方财富公告聚合。财报预告、业绩预告、业绩预增/预减、定期报告、重大合同、监管处罚、异常波动公告都属于重点消息。",
    "2. 公司官方网站最近 48 小时发布的信息。",
    "3. 权威互动平台：沪市使用上证 e 互动 http://sns.sseinfo.com/；深市使用深交所互动易 https://irm.cninfo.com.cn/。",
    "4. 官方投资者交流问答内容，时间范围 48 小时内。",
    "5. 媒体：东方财富、澎湃、界面新闻、科创板日报，时间范围 48 小时内。",
    `6. 雪球论坛当天交易日帖子：https://xueqiu.com/S/${xueqiuPrefix}${code}。如果雪球帖子提到可能影响走势的消息，必须尝试到权威渠道查证；没有被证伪且有合理依据时才输出，并标明可信度。`,
    "",
    "程序预抓取的东方财富公告候选：",
    formatNoticeCandidates(noticeCandidates, noticeErrorMessage),
    "请逐条核对这些候选公告是否属于有效消息。标题包含财报预告、业绩预告、业绩预增、业绩预减、定期报告、重大合同、监管处罚、股票交易异常波动时，通常应输出为消息。",
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
    "如果没有新的有效消息，输出 []。",
    "执行约束：只使用内置联网搜索/网页访问能力，不要执行 PowerShell、cmd、shell 或其他本地命令；最多进行 12 次联网检索，并尽快输出最终 JSON。"
  ].join("\n");
}

function formatNoticeCandidates(
  candidates: WatchNewsNoticeCandidate[],
  errorMessage: string | undefined
): string {
  if (errorMessage) {
    return `公告候选拉取失败：${errorMessage}`;
  }
  if (candidates.length === 0) {
    return "无";
  }
  return candidates.map((candidate) => [
    `- 标题：${candidate.title}`,
    `  来源：${candidate.sourceName}`,
    candidate.occurredAt ? `  时间：${candidate.occurredAt}` : undefined,
    `  摘要：${candidate.summary}`,
    candidate.sourceUrl ? `  链接：${candidate.sourceUrl}` : undefined
  ].filter(Boolean).join("\n")).join("\n");
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

function readEastMoneyNoticeCandidates(
  value: unknown,
  stock: WatchNewsStockInput,
  now: Date,
  lookbackHours: number
): WatchNewsNoticeCandidate[] {
  const list = readEastMoneyNoticeList(value);
  return list.flatMap((item) => {
    const title = readString(item.title) ?? readString(item.title_ch);
    const artCode = readString(item.art_code);
    const displayTime = normalizeEastMoneyDisplayTime(
      readString(item.display_time) ?? readString(item.eiTime) ?? readString(item.notice_date)
    );
    if (!title || !artCode || !isWithinRecentHours(displayTime, now, lookbackHours)) {
      return [];
    }
    const columns = Array.isArray(item.columns)
      ? item.columns.flatMap((column) => {
          if (!column || typeof column !== "object" || Array.isArray(column)) {
            return [];
          }
          return readString((column as Record<string, unknown>).column_name) ?? [];
        })
      : [];
    return [{
      title,
      summary: columns.length > 0 ? columns.join("、") : "上市公司公告",
      sourceName: "东方财富公告",
      sourceUrl: `https://data.eastmoney.com/notices/detail/${stock.secid.split(".")[1] ?? stock.secid}/${artCode}.html`,
      occurredAt: displayTime
    }];
  });
}

function isMaterialNotice(candidate: WatchNewsNoticeCandidate): boolean {
  return /(业绩|财报|年报|季报|定期报告|重大|合同|中标|回购|增持|减持|处罚|立案|诉讼|仲裁|异常波动|风险提示|停牌|复牌|重组|收购|发行|分红|权益变动)/.test(
    `${candidate.title} ${candidate.summary}`
  );
}

function buildNoticeFallbackDraft(
  stock: WatchNewsStockInput,
  candidate: WatchNewsNoticeCandidate
): WatchNewsDraft {
  const direction = inferNoticeDirection(candidate.title);
  return {
    secid: stock.secid,
    stockName: stock.stockName,
    title: candidate.title,
    summary: `公司发布${candidate.summary || "重要公告"}，权威公告已捕获；AI 分析未完成，具体内容请查看公告原文。`,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    occurredAt: candidate.occurredAt,
    analysis: `AI 分析未完成。根据公告标题初步判断为${direction}信息，实际影响需结合公告原文和后续市场反应复核。`,
    confidence: "high"
  };
}

function inferNoticeDirection(title: string): string {
  if (/(预增|增长|扭亏|中标|增持|回购)/.test(title)) {
    return "偏利好";
  }
  if (/(预减|下降|亏损|减持|处罚|立案|诉讼|风险提示)/.test(title)) {
    return "偏利空";
  }
  return "中性或方向待确认";
}

function mergeWatchNewsDrafts(
  preferred: WatchNewsDraft[],
  fallback: WatchNewsDraft[]
): WatchNewsDraft[] {
  const result = [...preferred];
  const known = new Set(preferred.flatMap((draft) => [
    normalizeNewsIdentity(draft.sourceUrl),
    normalizeNewsIdentity(draft.title)
  ].filter(Boolean)));
  for (const draft of fallback) {
    const identities = [draft.sourceUrl, draft.title]
      .map(normalizeNewsIdentity)
      .filter(Boolean);
    if (identities.some((identity) => known.has(identity))) {
      continue;
    }
    result.push(draft);
    identities.forEach((identity) => known.add(identity));
  }
  return result;
}

function normalizeNewsIdentity(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function readEastMoneyNoticeList(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("东方财富公告返回格式错误");
  }
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("东方财富公告返回格式错误");
  }
  const list = (data as Record<string, unknown>).list;
  if (!Array.isArray(list)) {
    throw new Error("东方财富公告返回格式错误");
  }
  return list.flatMap((item) => item && typeof item === "object" && !Array.isArray(item)
    ? [item as Record<string, unknown>]
    : []);
}

function normalizeEastMoneyDisplayTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

function isWithinRecentHours(value: string | undefined, now: Date, hours: number): boolean {
  const date = parseChinaDateTime(value);
  if (!date) {
    return false;
  }
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= hours * 60 * 60 * 1000;
}

function parseChinaDateTime(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(value);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
}

async function readRunMeta(runDirectory: string): Promise<{
  secid?: string;
  stockName?: string;
  createdAt?: string;
  errorMessage?: string;
} | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(runDirectory, "meta.json"), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : undefined;
  } catch {
    return undefined;
  }
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function parseDebugEvents(raw: string): WatchNewsDebugEvent[] {
  const parser = new CodexJsonlParser();
  const parsed = parser.push(raw).concat(parser.flush());
  if (parsed.length > 0) {
    return parsed.map((event) => ({
      text: event.text,
      level: event.level,
      raw: event.raw
    }));
  }
  return raw.split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => ({ text: line, level: "info" as const, raw: line }));
}

function parseCreatedAtFromRunId(runId: string): string {
  const value = runId.split("-").slice(0, 4).join("-");
  return value || "";
}
