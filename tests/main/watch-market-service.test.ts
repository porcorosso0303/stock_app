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
    tradingDate: "2026-06-04",
    fetchedAt,
    points: [{ time: "09:31", price: 100, changePercent }]
  };
}

function trendWithTimes(times: string[], fetchedAt = "2026-06-04T01:31:00.000Z"): StockTrend {
  return {
    secid: "1.600519",
    tradingDate: "2026-06-04",
    fetchedAt,
    points: times.map((time, index) => ({
      time,
      price: 100 + index,
      changePercent: index
    }))
  };
}

function minuteRange(startTime: string, endTime: string): string[] {
  const start = minuteOfDay(startTime);
  const end = minuteOfDay(endTime);
  const times: string[] = [];
  for (let minute = start; minute <= end; minute += 1) {
    times.push(formatMinute(minute));
  }
  return times;
}

function minuteOfDay(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatMinute(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function marketDataProvider(
  overrides: Partial<MarketDataProvider>
): MarketDataProvider {
  return {
    id: "east-money",
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
      trends: [trendWithTimes(["09:30", "09:31"])]
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
      () => new Date("2026-06-04T01:31:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toEqual({
      tradingDate: "2026-06-04",
      quotes: cache.quotes,
      trends: cache.trends,
      history: [cache],
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
      tradingDate: "2026-06-04",
      fromCache: false
    });
    expect(cacheStore.write).toHaveBeenCalledWith(expect.objectContaining({
      tradingDate: "2026-06-04",
      quotes: [quote(-0.5)],
      trends: [trend(-0.5)]
    }));
  });

  it("writes cache using provider trading date instead of the current natural date", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue({ version: 2, days: [] }),
      write: vi.fn()
    };
    const fridayTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-05",
      fetchedAt: "2026-06-06T02:00:00.000Z",
      points: [{ time: "15:00", price: 100, changePercent: 1.2 }]
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2, "2026-06-06T02:00:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([fridayTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-06T02:00:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      tradingDate: "2026-06-05",
      trends: [fridayTrend],
      fromCache: false
    });
    expect(cacheStore.write).toHaveBeenCalledWith(expect.objectContaining({
      tradingDate: "2026-06-05",
      trends: [fridayTrend]
    }));
  });

  it("uses the latest complete trading-day cache outside trading hours even when it was not written today", async () => {
    const fridayTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-05",
      fetchedAt: "2026-06-05T07:00:00.000Z",
      points: [
        ...minuteRange("09:30", "11:30"),
        ...minuteRange("13:00", "15:00")
      ].map((time, index) => ({
        time,
        price: 100 + index,
        changePercent: index
      }))
    };
    const historyDay = {
      tradingDate: "2026-06-05",
      updatedAt: "2026-06-05T07:00:00.000Z",
      quotes: [quote(1.2, "2026-06-05T07:00:00.000Z")],
      trends: [fridayTrend]
    };
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [historyDay]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn(),
      listTrends: vi.fn()
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-06T05:30:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      tradingDate: "2026-06-05",
      trends: [fridayTrend],
      history: [historyDay],
      fromCache: true
    });
    expect(quoteService.listQuotes).not.toHaveBeenCalled();
    expect(quoteService.listTrends).not.toHaveBeenCalled();
  });

  it("refetches on a weekend when the latest complete cache is older than the previous weekday", async () => {
    const oldTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-30",
      fetchedAt: "2026-06-30T07:00:00.000Z",
      points: [
        ...minuteRange("09:30", "11:30"),
        ...minuteRange("13:01", "15:00")
      ].map((time, index) => ({
        time,
        price: 100 + index,
        changePercent: index
      }))
    };
    const fridayTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-07-03",
      fetchedAt: "2026-07-04T03:30:00.000Z",
      points: [
        ...minuteRange("09:30", "11:30"),
        ...minuteRange("13:01", "15:00")
      ].map((time, index) => ({
        time,
        price: 200 + index,
        changePercent: index
      }))
    };
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [{
          tradingDate: "2026-06-30",
          updatedAt: "2026-06-30T07:00:00.000Z",
          quotes: [quote(1.2, "2026-06-30T07:00:00.000Z")],
          trends: [oldTrend]
        }]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(3.4, "2026-07-04T03:30:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([fridayTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-07-04T03:30:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      tradingDate: "2026-07-03",
      trends: [fridayTrend],
      fromCache: false
    });
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
    expect(cacheStore.write).toHaveBeenCalledWith(expect.objectContaining({
      tradingDate: "2026-07-03"
    }));
  });

  it("force refreshes latest provider data outside trading hours even when a cache is available", async () => {
    const cachedTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-07-03",
      fetchedAt: "2026-07-03T07:00:00.000Z",
      points: [
        ...minuteRange("09:30", "11:30"),
        ...minuteRange("13:01", "15:00")
      ].map((time, index) => ({
        time,
        price: 100 + index,
        changePercent: index
      }))
    };
    const freshTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-07-03",
      fetchedAt: "2026-07-04T04:00:00.000Z",
      points: [
        ...minuteRange("09:30", "11:30"),
        ...minuteRange("13:01", "15:00")
      ].map((time, index) => ({
        time,
        price: 200 + index,
        changePercent: index
      }))
    };
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [{
          tradingDate: "2026-07-03",
          updatedAt: "2026-07-03T07:00:00.000Z",
          quotes: [quote(1.2, "2026-07-03T07:00:00.000Z")],
          trends: [cachedTrend]
        }]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(2.5, "2026-07-04T04:00:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([freshTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-07-04T04:00:00.000Z")
    );

    await expect(service.refresh(["1.600519"], { forceLatest: true })).resolves.toMatchObject({
      tradingDate: "2026-07-03",
      quotes: [expect.objectContaining({ changePercent: 2.5 })],
      trends: [freshTrend],
      fromCache: false
    });
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
  });

  it("uses completed same-day cache after close when EastMoney omits the 13:00 point", async () => {
    const sameDayTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-17",
      fetchedAt: "2026-06-17T07:00:00.000Z",
      points: [
        ...minuteRange("09:30", "11:30"),
        ...minuteRange("13:01", "15:00")
      ].map((time, index) => ({
        time,
        price: 100 + index,
        changePercent: index
      }))
    };
    const sameDayCache: WatchMarketCache = {
      tradingDate: "2026-06-17",
      updatedAt: "2026-06-17T07:00:00.000Z",
      quotes: [quote(1.2, "2026-06-17T07:00:00.000Z")],
      trends: [sameDayTrend]
    };
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [sameDayCache]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn(),
      listTrends: vi.fn()
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-17T09:30:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      tradingDate: "2026-06-17",
      trends: [sameDayTrend],
      fromCache: true
    });
    expect(quoteService.listQuotes).not.toHaveBeenCalled();
    expect(quoteService.listTrends).not.toHaveBeenCalled();
  });

  it("does not fall back to an older cache after the current trading day has closed", async () => {
    const olderTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-08",
      fetchedAt: "2026-06-08T07:00:00.000Z",
      points: [
        ...minuteRange("09:30", "11:30"),
        ...minuteRange("13:01", "15:00")
      ].map((time, index) => ({
        time,
        price: 100 + index,
        changePercent: index
      }))
    };
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [{
          tradingDate: "2026-06-08",
          updatedAt: "2026-06-08T07:00:00.000Z",
          quotes: [quote(1.2, "2026-06-08T07:00:00.000Z")],
          trends: [olderTrend]
        }]
      }),
      write: vi.fn()
    };
    const freshTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-17",
      fetchedAt: "2026-06-17T09:30:00.000Z",
      points: [{ time: "15:00", price: 101.2, changePercent: 1.2 }]
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2, "2026-06-17T09:30:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([freshTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-17T09:30:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      tradingDate: "2026-06-17",
      trends: [freshTrend],
      fromCache: false
    });
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
  });

  it("does not overwrite existing cache when the provider returns only failed market data", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue({ version: 2, days: [] }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([{
        secid: "1.600519",
        fetchedAt: "2026-06-17T09:30:00.000Z",
        errorMessage: "fetch failed"
      }]),
      listTrends: vi.fn().mockResolvedValue([{
        secid: "1.600519",
        tradingDate: "2026-06-17",
        fetchedAt: "2026-06-17T09:30:00.000Z",
        points: [],
        errorMessage: "fetch failed"
      }])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-17T09:30:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      tradingDate: "2026-06-17",
      quotes: [expect.objectContaining({ errorMessage: "fetch failed" })],
      trends: [expect.objectContaining({ errorMessage: "fetch failed" })],
      fromCache: false
    });
    expect(cacheStore.write).not.toHaveBeenCalled();
  });

  it("bypasses cache reads and writes for ephemeral market data providers", async () => {
    const fullCache: WatchMarketCache = {
      tradingDate: "2026-06-17",
      updatedAt: "2026-06-17T07:00:00.000Z",
      quotes: [quote(8, "2026-06-17T07:00:00.000Z")],
      trends: [trendWithTimes(["09:30", "09:31", "15:00"], "2026-06-17T07:00:00.000Z")]
    };
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue(fullCache),
      getHistory: vi.fn().mockResolvedValue({ version: 2, days: [fullCache] }),
      write: vi.fn()
    };
    const replayTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-17",
      fetchedAt: "2026-06-17T01:30:00.000Z",
      points: [{ time: "09:30", price: 100, changePercent: 0 }]
    };
    const provider = marketDataProvider({
      cacheBehavior: "ephemeral",
      listQuotes: vi.fn().mockResolvedValue([quote(0, "2026-06-17T01:30:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([replayTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      provider,
      () => new Date("2026-06-17T09:30:00.000Z")
    );

    await expect(service.get(["1.600519"])).resolves.toMatchObject({
      quotes: [quote(0, "2026-06-17T01:30:00.000Z")],
      trends: [replayTrend],
      fromCache: false
    });
    expect(cacheStore.getHistory).not.toHaveBeenCalled();
    expect(cacheStore.getForDate).not.toHaveBeenCalled();
    expect(cacheStore.write).not.toHaveBeenCalled();
  });

  it("refetches during trading hours when cache does not cover the current minute", async () => {
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [{
          tradingDate: "2026-06-04",
          updatedAt: "2026-06-04T01:31:00.000Z",
          quotes: [quote(1.2)],
          trends: [trend(1.2)]
        }]
      }),
      write: vi.fn()
    };
    const freshTrend: StockTrend = {
      secid: "1.600519",
      tradingDate: "2026-06-04",
      fetchedAt: "2026-06-04T02:00:00.000Z",
      points: [{ time: "10:00", price: 100, changePercent: 1.2 }]
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2, "2026-06-04T02:00:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([freshTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T02:00:00.000Z")
    );

    const result = await service.get(["1.600519"]);

    expect(result.fromCache).toBe(false);
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
    expect(result.trends).toEqual([freshTrend]);
  });

  it("refetches during trading hours when cached trend has a missing minute", async () => {
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [{
          tradingDate: "2026-06-04",
          updatedAt: "2026-06-04T01:33:00.000Z",
          quotes: [quote(1.2)],
          trends: [trendWithTimes(["09:30", "09:31", "09:33"], "2026-06-04T01:33:00.000Z")]
        }]
      }),
      write: vi.fn()
    };
    const freshTrend = trendWithTimes(["09:30", "09:31", "09:32", "09:33"], "2026-06-04T01:33:00.000Z");
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2, "2026-06-04T01:33:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([freshTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T01:33:00.000Z")
    );

    const result = await service.get(["1.600519"]);

    expect(result.fromCache).toBe(false);
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
    expect(result.trends).toEqual([freshTrend]);
  });

  it("refetches outside trading hours when completed-day cache has an intraday gap", async () => {
    const cacheStore = {
      getForDate: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        version: 2,
        days: [{
          tradingDate: "2026-06-04",
          updatedAt: "2026-06-04T07:30:00.000Z",
          quotes: [quote(1.2)],
          trends: [trendWithTimes(["09:30", "09:31", "15:00"], "2026-06-04T07:30:00.000Z")]
        }]
      }),
      write: vi.fn()
    };
    const freshTrend = trendWithTimes(["09:30", "09:31", "09:32", "15:00"], "2026-06-04T07:30:00.000Z");
    const quoteService = marketDataProvider({
      listQuotes: vi.fn().mockResolvedValue([quote(1.2, "2026-06-04T07:30:00.000Z")]),
      listTrends: vi.fn().mockResolvedValue([freshTrend])
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T07:30:00.000Z")
    );

    const result = await service.get(["1.600519"]);

    expect(result.fromCache).toBe(false);
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519"]);
    expect(result.trends).toEqual([freshTrend]);
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

  it("keeps provider-standardized trend change percent without recalculating from quotes", async () => {
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
        tradingDate: "2026-06-04",
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

    expect(result.trends[0].points[0].changePercent).toBe(0);
    expect(result.trends[0].points[1].changePercent).toBe(0);
    expect(cacheStore.write).toHaveBeenCalledWith(expect.objectContaining({
      trends: [expect.objectContaining({
        points: [
          expect.objectContaining({ time: "09:30", changePercent: 0 }),
          expect.objectContaining({ time: "14:59", changePercent: 0 })
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
        tradingDate: "2026-06-04",
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
      tradingDate: "2026-06-04",
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
        tradingDate: "2026-06-04",
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
        tradingDate: "2026-06-05",
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
      changePercent: -2.68
    }));
  });

  it("refreshes full intraday trends during trading hours", async () => {
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
      listTrends: vi.fn().mockResolvedValue([
        trend(1.2, "2026-06-04T01:32:00.000Z"),
        {
        secid: "0.300750",
        tradingDate: "2026-06-04",
        fetchedAt: "2026-06-04T01:32:00.000Z",
        points: [{ time: "09:31", changePercent: -0.9 }]
        }
      ])
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
            { time: "09:31", changePercent: -0.9 }
          ]
        }
      ]
    });
    expect(quoteService.listTrends).toHaveBeenCalledWith(["1.600519", "0.300750"]);
  });

  it("uses complete cache during refresh outside trading hours", async () => {
    const cacheStore = {
      getForDate: vi.fn().mockResolvedValue({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T07:00:00.000Z",
        quotes: [quote(-0.5)],
        trends: [trendWithTimes([
          ...minuteRange("09:30", "11:30"),
          ...minuteRange("13:00", "15:00")
        ], "2026-06-04T07:00:00.000Z")]
      }),
      write: vi.fn()
    };
    const quoteService = marketDataProvider({
      listQuotes: vi.fn(),
      listTrends: vi.fn()
    });
    const service = new WatchMarketService(
      cacheStore,
      quoteService,
      () => new Date("2026-06-04T07:30:00.000Z")
    );

    await expect(service.refresh(["1.600519"])).resolves.toMatchObject({
      quotes: [quote(-0.5)],
      trends: [{
        secid: "1.600519",
        points: expect.arrayContaining([expect.objectContaining({ time: "15:00" })])
      }],
      fromCache: true
    });
    expect(quoteService.listQuotes).not.toHaveBeenCalled();
    expect(quoteService.listTrends).not.toHaveBeenCalled();
  });
});
