import { describe, expect, it, vi } from "vitest";
import type { MarketDataProvider } from "../../src/main/modules/watch/market-data/market-data-provider";
import { WatchMarketService } from "../../src/main/watch-market-service";
import type { StockQuote, StockTrend, WatchMarketCache } from "../../src/shared/types";

function quote(changePercent: number, fetchedAt = "2026-06-04T01:31:00.000Z"): StockQuote {
  return {
    secid: "1.600519",
    fetchedAt,
    changePercent
  };
}

function trend(changePercent: number, fetchedAt = "2026-06-04T01:31:00.000Z"): StockTrend {
  return {
    secid: "1.600519",
    fetchedAt,
    points: [{ time: "09:31", price: 100, changePercent }]
  };
}

function marketDataProvider(
  overrides: Partial<MarketDataProvider>
): MarketDataProvider {
  return {
    id: "fake",
    label: "Fake Provider",
    listQuotes: vi.fn(),
    listTrends: vi.fn(),
    searchStocks: vi.fn(),
    ...overrides
  };
}

describe("WatchMarketService", () => {
  it("loads fresh data through the market data provider interface", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn()
    };
    const provider = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(-0.5)]),
      listTrends: vi.fn().mockResolvedValue([trend(-0.5)])
    });
    const service = new WatchMarketService(
      cacheStore,
      provider,
      () => new Date("2026-06-05T10:00:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      quotes: [quote(-0.5)],
      trends: [trend(-0.5)],
      fromCache: false
    });
    expect(provider.listQuotes).toHaveBeenCalledWith(["1.600519"]);
    expect(provider.listTrends).toHaveBeenCalledWith(["1.600519"]);
  });

  it("returns same-day cache without calling quote service", async () => {
    const cache: WatchMarketCache = {
      tradingDate: "2026-06-04",
      updatedAt: "2026-06-04T01:31:00.000Z",
      quotes: [quote(1.2)],
      trends: [trend(1.2)]
    };
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(cache),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn(),
      listTrends: vi.fn()
    });
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
    expect(quoteService.listQuotes).not.toHaveBeenCalled();
    expect(quoteService.listTrends).not.toHaveBeenCalled();
  });

  it("fetches and writes a new cache when same-day cache is unavailable", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(-0.5)]),
      listTrends: vi.fn().mockResolvedValue([trend(-0.5)])
    });
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

  it("refetches same-day cache from older builds that has no trend prices", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T01:31:00.000Z",
        quotes: [quote(1.2)],
        trends: [{
          secid: "1.600519",
          fetchedAt: "2026-06-04T01:31:00.000Z",
          points: [{ time: "09:31", changePercent: 48 }]
        }]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2)]),
      listTrends: vi.fn().mockResolvedValue([trend(1.2)])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T10:00:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      fromCache: false,
      trends: [{ points: [expect.objectContaining({ price: 100 })] }]
    });
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
  });

  it("refetches same-day cache with out-of-order trend points from older builds", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T10:31:00.000Z",
        quotes: [quote(1.2)],
        trends: [{
          secid: "1.600519",
          fetchedAt: "2026-06-04T10:31:00.000Z",
          points: [
            { time: "15:00", price: 529.31, changePercent: 7.53 },
            { time: "10:31", price: 529.31, changePercent: 7.53 }
          ]
        }]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2)]),
      listTrends: vi.fn().mockResolvedValue([trend(1.2)])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T10:32:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      fromCache: false,
      trends: [{ points: [expect.objectContaining({ time: "09:31" })] }]
    });
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
  });

  it("derives trend change percent from trend prices and the latest quote", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn()
    };
    const quoteWithPrice: StockQuote = {
      secid: "1.603986",
      fetchedAt: "2026-06-04T15:00:00.000Z",
      price: 529.31,
      changePercent: 7.53
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quoteWithPrice]),
      listTrends: vi.fn().mockResolvedValue([{
        secid: "1.603986",
        fetchedAt: "2026-06-04T15:00:00.000Z",
        points: [
          { time: "09:30", price: 487.05, changePercent: 0 },
          { time: "14:59", price: 529.31, changePercent: 0 }
        ]
      }])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T15:01:00.000Z")
    );

    const result = await service.get(["1.603986"]);

    expect(result.trends[0].points[0].changePercent).toBeCloseTo(-1.055, 3);
    expect(result.trends[0].points[1].changePercent).toBeCloseTo(7.53, 2);
    expect(cacheStore.write).toHaveBeenCalledWith(expect.objectContaining({
      trends: [expect.objectContaining({
        points: [
          expect.objectContaining({ time: "09:30", changePercent: expect.closeTo(-1.055, 3) }),
          expect.objectContaining({ time: "14:59", changePercent: expect.closeTo(7.53, 2) })
        ]
      })]
    }));
  });

  it("uses the latest trend point as a visible quote when the quote endpoint is unavailable", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([{
        secid: "1.603986",
        fetchedAt: "2026-06-04T15:00:00.000Z",
        errorMessage: "行情服务请求失败"
      }]),
      listTrends: vi.fn().mockResolvedValue([{
        secid: "1.603986",
        fetchedAt: "2026-06-04T15:00:00.000Z",
        points: [
          { time: "09:30", price: 487.05, changePercent: -1.05 },
          { time: "15:00", price: 529.31, changePercent: 7.53 }
        ]
      }])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T15:01:00.000Z")
    );

    await expect(service.get(["1.603986"])).resolves.toMatchObject({
      quotes: [{
        secid: "1.603986",
        price: 529.31,
        changePercent: 7.53,
        errorMessage: undefined
      }],
      fromCache: false
    });
  });

  it("fetches fresh data when same-day cache does not cover requested secids", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T01:31:00.000Z",
        quotes: [quote(1.2)],
        trends: [trend(1.2)]
      }),
      write: vi.fn()
    };
    const secondQuote: StockQuote = {
      secid: "0.300750",
      fetchedAt: "2026-06-04T01:32:00.000Z",
      changePercent: -0.8
    };
    const secondTrend: StockTrend = {
      secid: "0.300750",
      fetchedAt: "2026-06-04T01:32:00.000Z",
      points: [{ time: "09:32", changePercent: -0.8 }]
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2), secondQuote]),
      listTrends: vi.fn().mockResolvedValue([trend(1.2), secondTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T01:32:00.000Z")
    );

    await expect(service.get(["1.600519", "0.300750"])).resolves.toMatchObject({
      fromCache: false,
      quotes: [{ secid: "1.600519" }, { secid: "0.300750" }]
    });
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519", "0.300750"]);
    expect(cacheStore.write).toHaveBeenCalledOnce();
  });

  it("refetches when cached trend prices move but change percents are all zero", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T07:00:00.000Z",
        quotes: [{
          secid: "1.603986",
          fetchedAt: "2026-06-04T07:00:00.000Z",
          price: 488,
          changePercent: 0
        }],
        trends: [{
          secid: "1.603986",
          fetchedAt: "2026-06-04T07:00:00.000Z",
          points: [
            { time: "09:30", price: 507, changePercent: 0 },
            { time: "15:00", price: 488, changePercent: 0 }
          ]
        }]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([{
        secid: "1.603986",
        fetchedAt: "2026-06-04T08:00:00.000Z",
        price: 488,
        changePercent: 0
      }]),
      listTrends: vi.fn().mockResolvedValue([{
        secid: "1.603986",
        fetchedAt: "2026-06-04T08:00:00.000Z",
        points: [
          { time: "09:30", price: 507, changePercent: 3.89 },
          { time: "15:00", price: 488, changePercent: 0 }
        ]
      }])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T08:00:00.000Z")
    );

    const result = await service.get(["1.603986"]);

    expect(result.fromCache).toBe(false);
    expect(quoteService.listQuotes).toHaveBeenCalledWith(["1.603986"]);
    expect(result.trends[0].points[0].changePercent).toBeCloseTo(3.89);
  });

  it("refetches cache written during trading hours when trends already contain later points", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-06",
        updatedAt: "2026-06-06T02:54:00.000Z",
        quotes: [{
          secid: "1.603986",
          fetchedAt: "2026-06-06T02:54:00.000Z",
          price: 488,
          changePercent: -7.8
        }],
        trends: [{
          secid: "1.603986",
          fetchedAt: "2026-06-06T02:54:00.000Z",
          points: [
            { time: "10:49", price: 515.03, changePercent: -2.7 },
            { time: "10:50", price: 488, changePercent: -7.8 },
            { time: "15:00", price: 488, changePercent: -7.8 }
          ]
        }]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([{
        secid: "1.603986",
        fetchedAt: "2026-06-06T02:55:00.000Z",
        price: 488,
        changePercent: -7.8
      }]),
      listTrends: vi.fn().mockResolvedValue([{
        secid: "1.603986",
        fetchedAt: "2026-06-06T02:55:00.000Z",
        points: [
          { time: "10:49", price: 515.03, changePercent: -2.7 },
          { time: "10:50", price: 515.12, changePercent: -2.68 },
          { time: "15:00", price: 488, changePercent: -7.8 }
        ]
      }])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-06T02:55:00.000Z")
    );

    const result = await service.get(["1.603986"]);

    expect(result.fromCache).toBe(false);
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.603986"]);
    expect(result.trends[0].points).toContainEqual(expect.objectContaining({
      time: "10:50",
      price: 515.12,
      changePercent: expect.closeTo(-2.676, 3)
    }));
  });

  it("fetches missing trends during refresh for newly added stocks", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T01:31:00.000Z",
        quotes: [quote(-0.5)],
        trends: [trend(-0.5)]
      }),
      write: vi.fn()
    };
    const secondQuote: StockQuote = {
      secid: "0.300750",
      fetchedAt: "2026-06-04T01:32:00.000Z",
      changePercent: -0.8
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([
        quote(1.2, "2026-06-04T01:32:00.000Z"),
        secondQuote
      ]),
      listTrends: vi.fn().mockResolvedValue([{
        secid: "0.300750",
        fetchedAt: "2026-06-04T01:32:00.000Z",
        points: [{ time: "09:31", changePercent: -0.9 }]
      }])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T01:32:00.000Z")
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
    expect(quoteService.listTrends).toHaveBeenCalledWith(["0.300750"]);
  });

  it("refreshes quotes and merges latest quote points into same-day trends", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T01:31:00.000Z",
        quotes: [quote(-0.5)],
        trends: [trend(-0.5)]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2, "2026-06-04T01:32:00.000Z")]),
      listTrends: vi.fn()
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T01:32:00.000Z")
    );

    await expect(service.refresh(["1.600519"])).resolves.toMatchObject({
      quotes: [quote(1.2, "2026-06-04T01:32:00.000Z")],
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
