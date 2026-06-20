import type {
  StockQuote,
  StockSearchResult,
  StockTrend,
  WatchMarketHistoryCache
} from "../../../../shared/types";
import type { MarketDataProvider } from "./market-data-provider";

interface WatchMarketCacheStoreLike {
  getHistory(): Promise<WatchMarketHistoryCache>;
}

interface ReplaySnapshot {
  quotes: StockQuote[];
  trends: StockTrend[];
}

const DEFAULT_REPLAY_INTERVAL_MS = 10_000;

export class MockCacheMarketDataProvider implements MarketDataProvider {
  readonly id = "mock-cache" as const;
  readonly label = "模拟数据";
  readonly cacheBehavior = "ephemeral" as const;
  private startedAt: number | undefined;

  constructor(
    private readonly cacheStore: WatchMarketCacheStoreLike,
    private readonly now: () => Date = () => new Date(),
    private readonly replayIntervalMs = DEFAULT_REPLAY_INTERVAL_MS
  ) {}

  reset(): void {
    this.startedAt = this.now().getTime();
  }

  async listQuotes(secids: string[]): Promise<StockQuote[]> {
    return (await this.createReplaySnapshot(secids)).quotes;
  }

  async listTrends(secids: string[]): Promise<StockTrend[]> {
    return (await this.createReplaySnapshot(secids)).trends;
  }

  async searchStocks(query: string): Promise<StockSearchResult[]> {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return [];
    }
    const history = await this.cacheStore.getHistory();
    const stocks = new Map<string, StockSearchResult>();
    for (const day of history.days) {
      for (const quote of day.quotes) {
        const code = quote.secid.split(".")[1] ?? quote.secid;
        const name = quote.stockName ?? code;
        if (name.toLowerCase().includes(keyword) || code.includes(keyword)) {
          stocks.set(quote.secid, {
            secid: quote.secid,
            code,
            name,
            marketName: "模拟数据"
          });
        }
      }
    }
    return [...stocks.values()];
  }

  private async createReplaySnapshot(secids: string[]): Promise<ReplaySnapshot> {
    const history = await this.cacheStore.getHistory();
    const cache = [...history.days]
      .sort((left, right) => right.tradingDate.localeCompare(left.tradingDate))
      .find((day) => secids.some((secid) => day.trends.some((trend) => (
        trend.secid === secid && trend.points.length > 0
      ))));
    const step = this.currentStep();
    const updatedAt = this.now().toISOString();
    if (!cache) {
      return {
        quotes: secids.map((secid) => ({
          secid,
          fetchedAt: updatedAt,
          errorMessage: "暂无可用于模拟的历史行情"
        })),
        trends: secids.map((secid) => ({
          secid,
          tradingDate: "",
          fetchedAt: updatedAt,
          points: [],
          errorMessage: "暂无可用于模拟的历史行情"
        }))
      };
    }

    const quotesBySecid = new Map(cache.quotes.map((quote) => [quote.secid, quote]));
    const trendsBySecid = new Map(cache.trends.map((trend) => [trend.secid, trend]));
    const trends = secids.map((secid) => {
      const source = trendsBySecid.get(secid);
      if (!source || source.points.length === 0) {
        return {
          secid,
          tradingDate: cache.tradingDate,
          fetchedAt: updatedAt,
          points: [],
          errorMessage: "模拟数据中缺少该股票走势"
        };
      }
      return {
        ...source,
        fetchedAt: updatedAt,
        points: source.points.slice(0, Math.min(step + 1, source.points.length))
      };
    });
    const quotes = trends.map((trend) => {
      const sourceQuote = quotesBySecid.get(trend.secid);
      const point = trend.points.at(-1);
      if (!point) {
        return {
          secid: trend.secid,
          stockName: sourceQuote?.stockName,
          fetchedAt: updatedAt,
          errorMessage: trend.errorMessage ?? "模拟数据中缺少该股票走势"
        };
      }
      return {
        ...sourceQuote,
        secid: trend.secid,
        price: point.price ?? sourceQuote?.price,
        changePercent: point.changePercent,
        fetchedAt: toChinaIso(cache.tradingDate, point.time)
      };
    });
    return { quotes, trends };
  }

  private currentStep(): number {
    const now = this.now().getTime();
    if (this.startedAt === undefined) {
      this.startedAt = now;
    }
    return Math.max(0, Math.floor((now - this.startedAt) / this.replayIntervalMs));
  }
}

function toChinaIso(tradingDate: string, time: string): string {
  return new Date(`${tradingDate}T${time}:00+08:00`).toISOString();
}
