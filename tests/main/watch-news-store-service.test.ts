import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WatchNewsService } from "../../src/main/watch-news-service";
import { WatchNewsStore } from "../../src/main/watch-news-store";
import type { WatchNewsAnalysisProvider } from "../../src/main/watch-news-analysis-provider";
import type { WatchTreeConfig } from "../../src/shared/types";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("WatchNewsStore", () => {
  it("deduplicates messages and marks unread messages as read", async () => {
    const store = await createStore();

    const inserted = await store.addMessages([
      draft("1.600001", "订单公告"),
      draft("1.600001", "订单公告")
    ], "2026-07-09T09:00:00.000Z");

    expect(inserted).toHaveLength(1);
    expect(await store.list(["1.600001"])).toHaveLength(1);
    const read = await store.markRead("1.600001", [inserted[0].id], "2026-07-09T09:05:00.000Z");
    expect(read[0].readAt).toBe("2026-07-09T09:05:00.000Z");
  });

  it("upgrades an AI-pending announcement in place without duplicating it", async () => {
    const store = await createStore();
    const fallback = {
      ...draft("1.603986", "业绩预增公告"),
      summary: "权威公告已捕获，AI 分析未完成。",
      analysis: "AI 分析未完成。",
      confidence: "high" as const
    };
    const [inserted] = await store.addMessages([fallback], "2026-07-12T10:00:00.000Z");
    await store.markRead("1.603986", [inserted.id], "2026-07-12T10:01:00.000Z");

    const newlyInserted = await store.addMessages([{
      ...fallback,
      sourceUrl: "https://www.sse.com.cn/disclosure/603986/forecast.pdf",
      summary: "预计上半年归母净利润同比显著增长。",
      analysis: "业绩超出市场预期，短期偏利好。"
    }], "2026-07-12T10:05:00.000Z");

    expect(newlyInserted).toEqual([]);
    const messages = await store.list(["1.603986"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: inserted.id,
      fetchedAt: "2026-07-12T10:00:00.000Z",
      readAt: "2026-07-12T10:01:00.000Z",
      summary: "预计上半年归母净利润同比显著增长。",
      analysis: "业绩超出市场预期，短期偏利好。"
    });
  });

  it("serializes concurrent message writes from different stocks", async () => {
    const store = await createStore();

    await Promise.all([
      store.addMessages([draft("1.600001", "消息 A")], "2026-07-12T10:00:00.000Z"),
      store.addMessages([draft("0.000001", "消息 B")], "2026-07-12T10:00:00.000Z")
    ]);

    await expect(store.list()).resolves.toHaveLength(2);
  });
});

describe("WatchNewsService", () => {
  it("analyzes only holding stocks from all workspaces and stores new messages", async () => {
    const store = await createStore();
    const provider: WatchNewsAnalysisProvider = {
      analyze: vi.fn(async (stock) => [draft(stock.secid, `${stock.stockName} 消息`)])
    };
    const service = new WatchNewsService(store, async () => provider, () => new Date("2026-07-09T10:00:00.000Z"));

    const result = await service.analyzeHoldingStocks(configWithHoldings());

    expect(result.stockCount).toBe(2);
    expect(result.newMessageCount).toBe(2);
    expect(provider.analyze).toHaveBeenCalledTimes(2);
    await expect(service.list()).resolves.toHaveLength(2);
  });

  it("stores and notifies partial announcements before batch AI analysis finishes", async () => {
    const store = await createStore();
    let releaseAnalysis!: () => void;
    const analysisGate = new Promise<void>((resolve) => {
      releaseAnalysis = resolve;
    });
    const provider = {
      analyze: vi.fn(async (
        stock: { secid: string; stockName: string },
        onPartialDrafts?: (drafts: ReturnType<typeof draft>[]) => Promise<void>
      ) => {
        await onPartialDrafts?.([{
          ...draft(stock.secid, `${stock.stockName} 公告`),
          analysis: "AI 分析未完成。"
        }]);
        await analysisGate;
        return [];
      })
    } as unknown as WatchNewsAnalysisProvider;
    const onMessagesChanged = vi.fn();
    const service = new WatchNewsService(
      store,
      async () => provider,
      () => new Date("2026-07-12T10:00:00.000Z"),
      onMessagesChanged
    );

    const running = service.analyzeHoldingStocks(configWithHoldings());
    try {
      await vi.waitFor(async () => {
        expect(await service.list()).toHaveLength(2);
      });
      expect(onMessagesChanged).toHaveBeenCalledTimes(2);
    } finally {
      releaseAnalysis();
      await running;
    }
  });

  it("uses one provider snapshot for every stock in a batch and resolves again next time", async () => {
    const store = await createStore();
    const firstProvider: WatchNewsAnalysisProvider = {
      analyze: vi.fn(async (stock) => [draft(stock.secid, `first-${stock.stockName}`)])
    };
    const secondProvider: WatchNewsAnalysisProvider = {
      analyze: vi.fn(async (stock) => [draft(stock.secid, `second-${stock.stockName}`)])
    };
    let selected = firstProvider;
    const resolver = vi.fn(async () => selected);
    const service = new WatchNewsService(store, resolver);

    await service.analyzeHoldingStocks(configWithHoldings());
    selected = secondProvider;
    await service.analyzeStock({ secid: "1.600003", stockName: "持仓D" });

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(firstProvider.analyze).toHaveBeenCalledTimes(2);
    expect(secondProvider.analyze).toHaveBeenCalledTimes(1);
  });

  it("reads debug output from the last provider used by an analysis", async () => {
    const store = await createStore();
    const provider: WatchNewsAnalysisProvider = {
      analyze: vi.fn().mockResolvedValue([]),
      getLatestDebugRun: vi.fn().mockResolvedValue({ runId: "last" })
    };
    const resolver = vi.fn(async () => provider);
    const service = new WatchNewsService(store, resolver);

    await service.analyzeStock({ secid: "1.600003", stockName: "持仓D" });
    await service.getLatestDebugRun("1.600003");

    expect(resolver).toHaveBeenCalledOnce();
    expect(provider.getLatestDebugRun).toHaveBeenCalledWith("1.600003");
  });
});

async function createStore(): Promise<WatchNewsStore> {
  const directory = await mkdtemp(join(tmpdir(), "watch-news-"));
  directories.push(directory);
  return new WatchNewsStore(join(directory, "watch-news.json"));
}

function draft(secid: string, title: string) {
  return {
    secid,
    stockName: secid,
    title,
    summary: "48小时内有可能影响股价的消息。",
    sourceName: "测试来源",
    sourceUrl: `https://example.com/${encodeURIComponent(title)}`,
    analysis: "偏利好，需继续跟踪。",
    confidence: "medium" as const
  };
}

function configWithHoldings(): WatchTreeConfig {
  return {
    workspaces: [{
      id: "a",
      name: "A",
      root: {
        id: "root-a",
        type: "category",
        name: "A",
        children: [
          { id: "stock-a", type: "stock", name: "持仓A", secid: "1.600001", isHolding: true },
          { id: "stock-b", type: "stock", name: "非持仓", secid: "1.600002" }
        ]
      }
    }, {
      id: "b",
      name: "B",
      root: {
        id: "root-b",
        type: "category",
        name: "B",
        children: [
          { id: "stock-c", type: "stock", name: "持仓C", secid: "0.000001", isHolding: true }
        ]
      }
    }]
  };
}
