import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekAgentProgress } from "../../src/main/deepseek-agent-runner";
import {
  DeepSeekWatchNewsAnalysisProvider,
  buildDeepSeekWatchNewsPrompts,
  type WatchNewsNoticeSource
} from "../../src/main/watch-news-analysis-provider";
import type { WatchNewsDraft } from "../../src/main/watch-news-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deepseek-watch-news-"));
  directories.push(directory);
  return directory;
}

describe("DeepSeekWatchNewsAnalysisProvider", () => {
  it("uses common notice prefetch and emits material fallback before creating the agent", async () => {
    const userDataDirectory = await createDirectory();
    let agentCreated = false;
    let agentWasCreatedAtEmission = true;
    let partial: WatchNewsDraft[] = [];
    const noticeSource: WatchNewsNoticeSource = {
      listRecent: vi.fn().mockResolvedValue([materialNotice()])
    };
    const provider = new DeepSeekWatchNewsAnalysisProvider({
      model: "deepseek-v4-pro",
      userDataDirectory,
      noticeSource,
      now: () => new Date("2026-07-20T10:00:00.000Z"),
      createAgent: () => {
        agentCreated = true;
        return { run: async () => "[]", cancel: vi.fn() };
      }
    });

    await provider.analyze(stock([]), async (drafts) => {
      agentWasCreatedAtEmission = agentCreated;
      partial = drafts;
    });

    expect(noticeSource.listRecent).toHaveBeenCalledWith(expect.anything(), expect.any(Date), 168);
    expect(agentWasCreatedAtEmission).toBe(false);
    expect(partial).toHaveLength(1);
    expect(partial[0].analysis).toContain("AI 分析未完成");
  });

  it("searches required sources and normalizes DeepSeek JSON output", async () => {
    const userDataDirectory = await createDirectory();
    let capturedRequest: { systemPrompt: string; userPrompt: string } | undefined;
    const provider = new DeepSeekWatchNewsAnalysisProvider({
      model: "deepseek-v4-pro",
      userDataDirectory,
      now: () => new Date("2026-07-20T10:00:00.000Z"),
      createAgent: (onProgress) => ({
        run: async (request) => {
          capturedRequest = request;
          onProgress({ kind: "status", text: "执行工具 web_search" });
          return JSON.stringify([{
            title: "订单公告",
            summary: "公司取得重大订单",
            sourceName: "公司官网",
            sourceUrl: "https://example.com/notice",
            occurredAt: "2026-07-20T09:00:00+08:00",
            analysis: "订单可能增厚业绩，偏利好",
            confidence: "high"
          }]);
        },
        cancel: vi.fn()
      })
    });

    const drafts = await provider.analyze(stock([{ title: "旧消息", fetchedAt: "2026-07-19T00:00:00Z" }]));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ secid: "1.603986", stockName: "兆易创新", confidence: "high" });
    expect(capturedRequest?.systemPrompt).toContain("web_search");
    expect(capturedRequest?.userPrompt).toContain("上证 e 互动");
    expect(capturedRequest?.userPrompt).toContain("深交所互动易");
    expect(capturedRequest?.userPrompt).toContain("东方财富");
    expect(capturedRequest?.userPrompt).toContain("澎湃");
    expect(capturedRequest?.userPrompt).toContain("界面新闻");
    expect(capturedRequest?.userPrompt).toContain("科创板日报");
    expect(capturedRequest?.userPrompt).toContain("雪球");
    expect(capturedRequest?.userPrompt).toContain("权威渠道查证");
    expect((await provider.getLatestDebugRun("1.603986"))?.events.some((event) =>
      event.text.includes("web_search")
    )).toBe(true);
  });

  it("keeps prefetched material announcements if DeepSeek fails", async () => {
    const userDataDirectory = await createDirectory();
    const provider = new DeepSeekWatchNewsAnalysisProvider({
      model: "deepseek-v4-pro",
      userDataDirectory,
      noticeSource: { listRecent: async () => [materialNotice()] },
      createAgent: () => ({
        run: async () => { throw new Error("Tavily 检索额度不足"); },
        cancel: vi.fn()
      })
    });

    const drafts = await provider.analyze(stock([]));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].confidence).toBe("high");
    expect((await provider.getLatestDebugRun("1.603986"))?.errorMessage)
      .toContain("Tavily 检索额度不足");
  });

  it("uses a 48-hour notice window after message history exists", async () => {
    const userDataDirectory = await createDirectory();
    const listRecent = vi.fn().mockResolvedValue([]);
    const provider = new DeepSeekWatchNewsAnalysisProvider({
      model: "deepseek-v4-pro",
      userDataDirectory,
      noticeSource: { listRecent },
      createAgent: () => ({ run: async () => "[]", cancel: vi.fn() })
    });

    await provider.analyze(stock([{ title: "历史消息", fetchedAt: "2026-07-19T00:00:00Z" }]));

    expect(listRecent).toHaveBeenCalledWith(expect.anything(), expect.any(Date), 48);
  });

  it("builds a strict provider-neutral source and output prompt", () => {
    const prompts = buildDeepSeekWatchNewsPrompts(
      stock([]),
      new Date("2026-07-20T10:00:00.000Z"),
      [],
      undefined,
      168
    );

    expect(prompts.systemPrompt).toContain("只输出 JSON");
    expect(prompts.userPrompt).not.toContain("Codex");
    expect(prompts.userPrompt).toContain("48 小时");
  });
});

function stock(existingMessages: Array<{ title: string; fetchedAt: string; sourceUrl?: string }>) {
  return { secid: "1.603986", stockName: "兆易创新", existingMessages };
}

function materialNotice() {
  return {
    title: "兆易创新2026年半年度业绩预增公告",
    summary: "预计净利润增长",
    sourceName: "东方财富公告",
    sourceUrl: "https://example.com/forecast",
    occurredAt: "2026-07-20T08:00:00+08:00"
  };
}
