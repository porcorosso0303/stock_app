import { describe, expect, it } from "vitest";
import { MockCacheMarketDataProvider } from "../../src/main/modules/watch/market-data/mock-cache-provider";
import type { WatchMarketHistoryCache } from "../../src/shared/types";

describe("MockCacheMarketDataProvider", () => {
  it("replays the latest cached trading day from the first intraday point", async () => {
    let now = new Date("2026-06-17T01:30:00.000Z");
    const provider = new MockCacheMarketDataProvider(cacheStore(history), () => now, 10_000);

    const firstTrends = await provider.listTrends(["1.600001"]);
    const firstQuotes = await provider.listQuotes(["1.600001"]);
    now = new Date("2026-06-17T01:30:10.000Z");
    const secondTrends = await provider.listTrends(["1.600001"]);
    const secondQuotes = await provider.listQuotes(["1.600001"]);

    expect(firstTrends[0].tradingDate).toBe("2026-06-16");
    expect(firstTrends[0].points).toEqual([
      { time: "09:30", price: 10, changePercent: 0 }
    ]);
    expect(firstQuotes[0]).toMatchObject({
      secid: "1.600001",
      price: 10,
      changePercent: 0
    });
    expect(secondTrends[0].points).toEqual([
      { time: "09:30", price: 10, changePercent: 0 },
      { time: "09:31", price: 10.2, changePercent: 2 }
    ]);
    expect(secondQuotes[0]).toMatchObject({
      secid: "1.600001",
      price: 10.2,
      changePercent: 2
    });
  });
});

const history: WatchMarketHistoryCache = {
  version: 2,
  days: [{
    tradingDate: "2026-06-16",
    updatedAt: "2026-06-16T07:00:00.000Z",
    quotes: [{
      secid: "1.600001",
      stockName: "测试股",
      price: 10.8,
      changePercent: 8,
      fetchedAt: "2026-06-16T07:00:00.000Z"
    }],
    trends: [{
      secid: "1.600001",
      tradingDate: "2026-06-16",
      fetchedAt: "2026-06-16T07:00:00.000Z",
      points: [
        { time: "09:30", price: 10, changePercent: 0 },
        { time: "09:31", price: 10.2, changePercent: 2 },
        { time: "09:32", price: 10.8, changePercent: 8 }
      ]
    }]
  }, {
    tradingDate: "2026-06-15",
    updatedAt: "2026-06-15T07:00:00.000Z",
    quotes: [],
    trends: []
  }]
};

function cacheStore(value: WatchMarketHistoryCache) {
  return {
    getHistory: async () => value
  };
}
