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
});

describe("WatchNewsService", () => {
  it("analyzes only holding stocks from all workspaces and stores new messages", async () => {
    const store = await createStore();
    const provider: WatchNewsAnalysisProvider = {
      analyze: vi.fn(async (stock) => [draft(stock.secid, `${stock.stockName} 消息`)])
    };
    const service = new WatchNewsService(store, provider, () => new Date("2026-07-09T10:00:00.000Z"));

    const result = await service.analyzeHoldingStocks(configWithHoldings());

    expect(result.stockCount).toBe(2);
    expect(result.newMessageCount).toBe(2);
    expect(provider.analyze).toHaveBeenCalledTimes(2);
    await expect(service.list()).resolves.toHaveLength(2);
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
