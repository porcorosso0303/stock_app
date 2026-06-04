import { describe, expect, it, vi } from "vitest";
import { WatchMarketService } from "../../src/main/watch-market-service";
import type { StockQuote, StockTrend, WatchMarketCache } from "../../src/shared/types";

function quote(changePercent: number, fetchedAt = "2026-06-04T09:31:00.000Z"): StockQuote {
  return {
    secid: "1.600519",
    fetchedAt,
    changePercent
  };
}

function trend(changePercent: number, fetchedAt = "2026-06-04T09:31:00.000Z"): StockTrend {
  return {
    secid: "1.600519",
    fetchedAt,
    points: [{ time: "09:31", changePercent }]
  };
}

describe("WatchMarketService", () => {
  it("returns same-day cache without calling quote service", async () => {
    const cache: WatchMarketCache = {
      tradingDate: "2026-06-04",
      updatedAt: "2026-06-04T09:31:00.000Z",
      quotes: [quote(1.2)],
      trends: [trend(1.2)]
    };
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(cache),
      write: vi.fn()
    };
    const quoteService = {
      list: vi.fn(),
      trends: vi.fn()
    };
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T10:00:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toEqual({
      quotes: cache.quotes,
      trends: cache.trends,
      updatedAt: cache.updatedAt,
      fromCache: true
    });
    expect(quoteService.list).not.toHaveBeenCalled();
    expect(quoteService.trends).not.toHaveBeenCalled();
  });

  it("fetches and writes a new cache when same-day cache is unavailable", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn()
    };
    const quoteService = {
      list: vi.fn().mockResolvedValue([quote(-0.5)]),
      trends: vi.fn().mockResolvedValue([trend(-0.5)])
    };
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-05T10:00:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      quotes: [quote(-0.5)],
      trends: [trend(-0.5)],
      fromCache: false
    });
    expect(cacheStore.write).toHaveBeenCalledWith(expect.objectContaining({
      tradingDate: "2026-06-05",
      quotes: [quote(-0.5)],
      trends: [trend(-0.5)]
    }));
  });

  it("fetches fresh data when same-day cache does not cover requested secids", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T09:31:00.000Z",
        quotes: [quote(1.2)],
        trends: [trend(1.2)]
      }),
      write: vi.fn()
    };
    const secondQuote: StockQuote = {
      secid: "0.300750",
      fetchedAt: "2026-06-04T09:32:00.000Z",
      changePercent: -0.8
    };
    const secondTrend: StockTrend = {
      secid: "0.300750",
      fetchedAt: "2026-06-04T09:32:00.000Z",
      points: [{ time: "09:32", changePercent: -0.8 }]
    };
    const quoteService = {
      list: vi.fn().mockResolvedValue([quote(1.2), secondQuote]),
      trends: vi.fn().mockResolvedValue([trend(1.2), secondTrend])
    };
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T09:32:00.000Z")
    );

    await expect(service.get(["1.600519", "0.300750"])).resolves.toMatchObject({
      fromCache: false,
      quotes: [{ secid: "1.600519" }, { secid: "0.300750" }]
    });
    expect(quoteService.trends).toHaveBeenCalledWith(["1.600519", "0.300750"]);
    expect(cacheStore.write).toHaveBeenCalledOnce();
  });

  it("fetches missing trends during refresh for newly added stocks", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T09:31:00.000Z",
        quotes: [quote(-0.5)],
        trends: [trend(-0.5)]
      }),
      write: vi.fn()
    };
    const secondQuote: StockQuote = {
      secid: "0.300750",
      fetchedAt: "2026-06-04T09:32:00.000Z",
      changePercent: -0.8
    };
    const quoteService = {
      list: vi.fn().mockResolvedValue([
        quote(1.2, "2026-06-04T09:32:00.000Z"),
        secondQuote
      ]),
      trends: vi.fn().mockResolvedValue([{
        secid: "0.300750",
        fetchedAt: "2026-06-04T09:32:00.000Z",
        points: [{ time: "09:31", changePercent: -0.9 }]
      }])
    };
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T09:32:00.000Z")
    );

    await expect(service.refresh(["1.600519", "0.300750"])).resolves.toMatchObject({
      trends: [
        { secid: "1.600519" },
        {
          secid: "0.300750",
          points: [
            { time: "09:31", changePercent: -0.9 },
            { time: "09:32", changePercent: -0.8 }
          ]
        }
      ]
    });
    expect(quoteService.trends).toHaveBeenCalledWith(["0.300750"]);
  });

  it("refreshes quotes and merges latest quote points into same-day trends", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T09:31:00.000Z",
        quotes: [quote(-0.5)],
        trends: [trend(-0.5)]
      }),
      write: vi.fn()
    };
    const quoteService = {
      list: vi.fn().mockResolvedValue([quote(1.2, "2026-06-04T09:32:00.000Z")]),
      trends: vi.fn()
    };
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T09:32:00.000Z")
    );

    await expect(service.refresh(["1.600519"])).resolves.toMatchObject({
      quotes: [quote(1.2, "2026-06-04T09:32:00.000Z")],
      trends: [{
        secid: "1.600519",
        points: [
          { time: "09:31", changePercent: -0.5 },
          { time: "09:32", changePercent: 1.2 }
        ]
      }],
      fromCache: false
    });
    expect(cacheStore.write).toHaveBeenCalledOnce();
  });
});
