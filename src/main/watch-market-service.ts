import type {
  StockQuote,
  StockTrend,
  WatchMarketCache,
  WatchMarketHistoryCache,
  WatchMarketData
} from "../shared/types";
import type { MarketDataProvider } from "./modules/watch/market-data/market-data-provider";

interface WatchMarketCacheStoreLike {
  getForDate(date: string): Promise<WatchMarketCache | undefined>;
  getHistory?(): Promise<WatchMarketHistoryCache>;
  write(cache: WatchMarketCache): Promise<void>;
}

export class WatchMarketService {
  constructor(
    private readonly cacheStore: WatchMarketCacheStoreLike,
    private readonly marketDataProvider: MarketDataProvider,
    private readonly now: () => Date = () => new Date()
  ) {}

  async get(secids: string[]): Promise<WatchMarketData> {
    const now = this.now();
    const currentDate = formatChinaDate(now);
    const cache = await this.findUsableCache(secids, now);
    if (cache) {
      return {
        tradingDate: cache.tradingDate,
        quotes: cache.quotes,
        trends: cache.trends,
        updatedAt: cache.updatedAt,
        fromCache: true
      };
    }

    return await this.fetchFresh(secids, currentDate);
  }

  async refresh(secids: string[]): Promise<WatchMarketData> {
    const now = this.now();
    if (isTradingMinute(formatChinaMinute(now.toISOString()))) {
      return await this.fetchFresh(secids, formatChinaDate(now));
    }
    return await this.get(secids);
  }

  private async fetchFresh(secids: string[], fallbackTradingDate: string): Promise<WatchMarketData> {
    const [rawQuotes, trends] = await Promise.all([
      this.marketDataProvider.listQuotes(secids),
      this.marketDataProvider.listTrends(secids)
    ]);
    const tradingDate = selectTradingDate(trends) ?? fallbackTradingDate;
    const quotes = fillUnavailableQuotesFromTrends(rawQuotes, trends);
    const updatedAt = this.now().toISOString();
    await this.cacheStore.write({
      tradingDate,
      quotes,
      trends,
      updatedAt
    });
    return {
      tradingDate,
      quotes,
      trends,
      updatedAt,
      fromCache: false
    };
  }

  private async findUsableCache(
    secids: string[],
    now: Date
  ): Promise<WatchMarketCache | undefined> {
    const currentDate = formatChinaDate(now);
    const history = this.cacheStore.getHistory
      ? await this.cacheStore.getHistory()
      : { version: 2 as const, days: [] };
    const candidates = history.days.length > 0
      ? history.days
      : [await this.cacheStore.getForDate(currentDate)].filter((cache): cache is WatchMarketCache => !!cache);
    return candidates.find((cache) => shouldConsiderCache(cache, now) && coversSecids(cache, secids, now));
  }
}

function selectTradingDate(trends: StockTrend[]): string | undefined {
  return trends.find((trend) => !trend.errorMessage && trend.tradingDate)?.tradingDate ??
    trends.find((trend) => trend.tradingDate)?.tradingDate;
}

function coversSecids(cache: WatchMarketCache, secids: string[], now: Date): boolean {
  const quoteSecids = new Set(cache.quotes.map((quote) => quote.secid));
  const trendSecids = new Set(
    cache.trends
      .filter((trend) => trend.tradingDate === cache.tradingDate)
      .filter((trend) => trend.points.every((point) => typeof point.price === "number"))
      .filter((trend) => hasOrderedTrendPoints(trend))
      .filter((trend) => hasUsableTrendChangePercents(trend))
      .filter((trend) => hasNoFutureTrendPointsAtUpdate(trend, cache.tradingDate, cache.updatedAt))
      .filter((trend) => hasRequiredCoverage(trend, cache.tradingDate, now))
      .map((trend) => trend.secid)
  );
  return secids.every((secid) => quoteSecids.has(secid) && trendSecids.has(secid));
}

function shouldConsiderCache(cache: WatchMarketCache, now: Date): boolean {
  const currentDate = formatChinaDate(now);
  if (cache.tradingDate === currentDate) {
    return true;
  }
  return !isTradingMinute(formatChinaMinute(now.toISOString())) &&
    formatChinaDate(new Date(cache.updatedAt)) === currentDate;
}

function hasOrderedTrendPoints(trend: StockTrend): boolean {
  return trend.points.every((point, index) => {
    if (index === 0) {
      return true;
    }
    return trendMinute(point.time) >= trendMinute(trend.points[index - 1].time);
  });
}

function hasUsableTrendChangePercents(trend: StockTrend): boolean {
  if (trend.points.length < 2) {
    return true;
  }
  const hasMovingPrice = trend.points.some((point) => point.price !== trend.points[0].price);
  const allZeroChangePercent = trend.points.every((point) => point.changePercent === 0);
  return !hasMovingPrice || !allZeroChangePercent;
}

function hasNoFutureTrendPointsAtUpdate(
  trend: StockTrend,
  tradingDate: string,
  updatedAt: string
): boolean {
  if (tradingDate !== formatChinaDate(new Date(updatedAt))) {
    return true;
  }
  const updateMinute = formatChinaMinute(updatedAt);
  if (!isTradingMinute(updateMinute)) {
    return true;
  }
  const updateTrendMinute = trendMinute(updateMinute);
  return trend.points.every((point) => trendMinute(point.time) <= updateTrendMinute);
}

function hasRequiredCoverage(trend: StockTrend, tradingDate: string, now: Date): boolean {
  const requiredMinute = requiredCoverageMinute(tradingDate, now);
  const latestMinute = Math.max(...trend.points.map((point) => trendMinute(point.time)));
  return latestMinute >= trendMinute(requiredMinute);
}

function requiredCoverageMinute(tradingDate: string, now: Date): string {
  const currentDate = formatChinaDate(now);
  if (tradingDate !== currentDate) {
    return "15:00";
  }
  const currentMinute = formatChinaMinute(now.toISOString());
  if (currentMinute < "09:30") {
    return "15:00";
  }
  if (currentMinute <= "11:30") {
    return currentMinute;
  }
  if (currentMinute < "13:00") {
    return "11:30";
  }
  if (currentMinute <= "15:00") {
    return currentMinute;
  }
  return "15:00";
}

function fillUnavailableQuotesFromTrends(
  quotes: StockQuote[],
  trends: StockTrend[]
): StockQuote[] {
  const trendsBySecid = new Map(trends.map((trend) => [trend.secid, trend]));
  return quotes.map((quote) => {
    if (quote.changePercent !== undefined) {
      return quote;
    }
    const latestPoint = latestTrendPoint(trendsBySecid.get(quote.secid));
    if (!latestPoint) {
      return quote;
    }
    return {
      ...quote,
      price: latestPoint.price,
      changePercent: latestPoint.changePercent,
      fetchedAt: quote.fetchedAt || trendsBySecid.get(quote.secid)?.fetchedAt || new Date().toISOString(),
      errorMessage: undefined
    };
  });
}

function latestTrendPoint(trend: StockTrend | undefined): StockTrend["points"][number] | undefined {
  return trend?.points.at(-1);
}

function trendMinute(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function isTradingMinute(time: string): boolean {
  const minute = trendMinute(time);
  return (minute >= trendMinute("09:30") && minute <= trendMinute("11:30")) ||
    (minute >= trendMinute("13:00") && minute <= trendMinute("15:00"));
}

function formatChinaMinute(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.includes("T") ? value.slice(11, 16) : value.slice(0, 5);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("hour")}:${byType.get("minute")}`;
}

function formatChinaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}
