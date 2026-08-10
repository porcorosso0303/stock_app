import type {
  StockQuote,
  StockTrend,
  WatchMarketCache,
  WatchMarketHistoryCache,
  WatchMarketRequestOptions,
  WatchMarketData
} from "../shared/types";
import type { WatchMarketRefreshOptions } from "../shared/ipc";
import { hasCompleteIntradayCoverage } from "../shared/data-calc-helper";
import type { MarketDataProvider } from "./modules/watch/market-data/market-data-provider";

const MAX_LATEST_TRADING_DATE_LOOKBACK_WEEKDAYS = 10;

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

  async get(secids: string[], options: WatchMarketRequestOptions = {}): Promise<WatchMarketData> {
    if (options.tradingDate) {
      return await this.getForTradingDate(secids, options.tradingDate);
    }
    const now = this.now();
    const currentDate = formatChinaDate(now);
    if (!this.usesEphemeralProvider()) {
      const cache = await this.findUsableCache(secids, now);
      if (cache) {
        return {
          tradingDate: cache.tradingDate,
          quotes: cache.quotes,
          trends: cache.trends,
          history: await this.historyWith(cache),
          updatedAt: cache.updatedAt,
          fromCache: true
        };
      }
    }

    return this.shouldUseLiveTrends(now)
      ? await this.fetchFresh(secids, currentDate)
      : await this.fetchLatestTradingDate(secids, requiredLatestCacheTradingDate(now));
  }

  async refresh(secids: string[], options: WatchMarketRefreshOptions = {}): Promise<WatchMarketData> {
    const now = this.now();
    if (this.shouldUseLiveTrends(now)) {
      return await this.fetchFresh(secids, formatChinaDate(now));
    }
    if (options.forceLatest) {
      return await this.fetchLatestTradingDate(secids, requiredLatestCacheTradingDate(now));
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
    const cache = {
      tradingDate,
      quotes,
      trends,
      updatedAt
    };
    if (!this.usesEphemeralProvider() && hasAnyUsableMarketData(cache)) {
      await this.cacheStore.write(cache);
    }
    return {
      tradingDate,
      quotes,
      trends,
      history: this.usesEphemeralProvider() ? [cache] : await this.historyWith(cache),
      updatedAt,
      fromCache: false
    };
  }

  private async getForTradingDate(secids: string[], tradingDate: string): Promise<WatchMarketData> {
    if (!this.usesEphemeralProvider()) {
      const cache = await this.findUsableCacheForDate(secids, tradingDate);
      if (cache) {
        return {
          tradingDate: cache.tradingDate,
          quotes: cache.quotes,
          trends: cache.trends,
          history: await this.historyWith(cache),
          updatedAt: cache.updatedAt,
          fromCache: true
        };
      }
    }
    return await this.fetchTradingDate(secids, tradingDate);
  }

  private async fetchTradingDate(secids: string[], tradingDate: string): Promise<WatchMarketData> {
    const providerTrends = await this.marketDataProvider.listTrends(secids, { tradingDate });
    const trends = normalizeSelectedDateTrends(secids, providerTrends, tradingDate, this.now().toISOString());
    const updatedAt = this.now().toISOString();
    const quotes = quotesFromTrends(secids, trends, updatedAt);
    const cache = {
      tradingDate,
      quotes,
      trends,
      updatedAt
    };
    if (!this.usesEphemeralProvider() && hasAnyUsableMarketData(cache)) {
      await this.cacheStore.write(cache);
    }
    return {
      tradingDate,
      quotes,
      trends,
      history: this.usesEphemeralProvider() ? [cache] : await this.historyWith(cache),
      updatedAt,
      fromCache: false
    };
  }

  private async fetchLatestTradingDate(secids: string[], tradingDate: string): Promise<WatchMarketData> {
    const [rawQuotes, initialTrends] = await Promise.all([
      this.marketDataProvider.listQuotes(secids),
      this.marketDataProvider.listTrends(secids, { tradingDate })
    ]);
    let resolvedTradingDate = tradingDate;
    let providerTrends = initialTrends;
    let candidateDate = tradingDate;
    for (
      let attempt = 0;
      attempt < MAX_LATEST_TRADING_DATE_LOOKBACK_WEEKDAYS && isConfirmedNonTradingDate(secids, providerTrends);
      attempt += 1
    ) {
      candidateDate = previousChinaWeekday(candidateDate);
      const candidateTrends = await this.marketDataProvider.listTrends(secids, { tradingDate: candidateDate });
      if (!isConfirmedNonTradingDate(secids, candidateTrends)) {
        resolvedTradingDate = candidateDate;
        providerTrends = candidateTrends;
        break;
      }
    }
    const updatedAt = this.now().toISOString();
    const trends = normalizeSelectedDateTrends(secids, providerTrends, resolvedTradingDate, updatedAt);
    const quotes = mergeQuoteMetadata(rawQuotes, quotesFromTrends(secids, trends, updatedAt));
    const cache = {
      tradingDate: resolvedTradingDate,
      quotes,
      trends,
      updatedAt
    };
    if (!this.usesEphemeralProvider() && hasAnyUsableMarketData(cache)) {
      await this.cacheStore.write(cache);
    }
    return {
      tradingDate: resolvedTradingDate,
      quotes,
      trends,
      history: await this.historyWith(cache),
      updatedAt,
      fromCache: false
    };
  }

  private usesEphemeralProvider(): boolean {
    return this.marketDataProvider.cacheBehavior === "ephemeral";
  }

  private shouldUseLiveTrends(now: Date): boolean {
    return this.usesEphemeralProvider() || isTradingSession(now);
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
    const requiredCacheDate = requiredLatestCacheTradingDate(now);
    const scopedCandidates = shouldUseCurrentTradingDateOnly(now)
      ? candidates.filter((cache) => cache.tradingDate === currentDate)
      : candidates.filter((cache) => cache.tradingDate === requiredCacheDate);
    return scopedCandidates.find((cache) => shouldConsiderCache(cache, now) && coversSecids(cache, secids, now));
  }

  private async findUsableCacheForDate(
    secids: string[],
    tradingDate: string
  ): Promise<WatchMarketCache | undefined> {
    const history = this.cacheStore.getHistory
      ? await this.cacheStore.getHistory()
      : { version: 2 as const, days: [] };
    return history.days
      .filter((cache) => cache.tradingDate === tradingDate)
      .find((cache) => coversSecids(cache, secids, new Date(`${tradingDate}T15:01:00+08:00`)));
  }

  private async historyWith(cache: WatchMarketCache): Promise<WatchMarketCache[]> {
    const history = this.cacheStore.getHistory
      ? await this.cacheStore.getHistory()
      : { version: 2 as const, days: [] };
    return sortAndLimitHistory([cache, ...history.days]);
  }
}

function hasAnyUsableMarketData(cache: WatchMarketCache): boolean {
  return cache.trends.some((trend) => trend.points.length > 0 && !trend.errorMessage);
}

function sortAndLimitHistory(days: WatchMarketCache[]): WatchMarketCache[] {
  const byDate = new Map(days.map((day) => [day.tradingDate, day]));
  return [...byDate.values()]
    .sort((left, right) => right.tradingDate.localeCompare(left.tradingDate))
    .slice(0, 5);
}

function selectTradingDate(trends: StockTrend[]): string | undefined {
  return trends.find((trend) => !trend.errorMessage && trend.tradingDate)?.tradingDate ??
    trends.find((trend) => trend.tradingDate)?.tradingDate;
}

function normalizeSelectedDateTrends(
  secids: string[],
  trends: StockTrend[],
  tradingDate: string,
  fetchedAt: string
): StockTrend[] {
  const trendsBySecid = new Map(trends.map((trend) => [trend.secid, trend]));
  const coverageTime = new Date(fetchedAt);
  return secids.map((secid) => {
    const trend = trendsBySecid.get(secid);
    const hasMatchingUsableTrend = trend?.tradingDate === tradingDate &&
      trend.points.length > 0 &&
      !trend.errorMessage;
    if (
      hasMatchingUsableTrend &&
      hasCompleteIntradayCoverage(trend.points, tradingDate, coverageTime)
    ) {
      return trend;
    }
    const hasIncompletePoints = hasMatchingUsableTrend && trend.points.length > 0;
    return {
      secid,
      tradingDate,
      fetchedAt: trend?.fetchedAt ?? fetchedAt,
      points: [],
      errorMessage: trend?.errorMessage ?? (
        hasIncompletePoints
          ? `${tradingDate} 行情数据不完整`
          : `未找到 ${tradingDate} 行情`
      ),
      errorKind: trend?.errorKind ?? (hasIncompletePoints ? "incomplete" : "not-found")
    };
  });
}

function isConfirmedNonTradingDate(secids: string[], trends: StockTrend[]): boolean {
  if (secids.length === 0) {
    return false;
  }
  const trendsBySecid = new Map(trends.map((trend) => [trend.secid, trend]));
  return secids.every((secid) => trendsBySecid.get(secid)?.errorKind === "not-found");
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
      .filter((trend) => hasCompleteIntradayCoverage(trend.points, cache.tradingDate, now))
      .map((trend) => trend.secid)
  );
  return secids.every((secid) => quoteSecids.has(secid) && trendSecids.has(secid));
}

function shouldConsiderCache(cache: WatchMarketCache, now: Date): boolean {
  return isTradingSession(now)
    ? cache.tradingDate === formatChinaDate(now)
    : true;
}

function shouldUseCurrentTradingDateOnly(now: Date): boolean {
  const day = chinaWeekday(now);
  return day >= 1 && day <= 5 && formatChinaMinute(now.toISOString()) >= "09:30";
}

function requiredLatestCacheTradingDate(now: Date): string {
  if (shouldUseCurrentTradingDateOnly(now)) {
    return formatChinaDate(now);
  }
  return previousChinaWeekday(formatChinaDate(now));
}

function previousChinaWeekday(chinaDate: string): string {
  let cursor = new Date(`${chinaDate}T00:00:00+08:00`);
  do {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  } while (chinaWeekday(cursor) > 5);
  return formatChinaDate(cursor);
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

function mergeQuoteMetadata(rawQuotes: StockQuote[], datedQuotes: StockQuote[]): StockQuote[] {
  const rawQuotesBySecid = new Map(rawQuotes.map((quote) => [quote.secid, quote]));
  return datedQuotes.map((quote) => ({
    ...rawQuotesBySecid.get(quote.secid),
    ...quote
  }));
}

function quotesFromTrends(
  secids: string[],
  trends: StockTrend[],
  fetchedAt: string
): StockQuote[] {
  const trendsBySecid = new Map(trends.map((trend) => [trend.secid, trend]));
  return secids.map((secid) => {
    const trend = trendsBySecid.get(secid);
    const latestPoint = latestTrendPoint(trend);
    if (!trend || !latestPoint) {
      return {
        secid,
        fetchedAt,
        errorMessage: trend?.errorMessage ?? "未找到该日期行情"
      };
    }
    return {
      secid,
      price: latestPoint.price,
      changePercent: latestPoint.changePercent,
      fetchedAt: trend.fetchedAt || fetchedAt,
      errorMessage: trend.errorMessage
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

function isTradingSession(date: Date): boolean {
  const day = chinaWeekday(date);
  return day >= 1 && day <= 5 && isTradingMinute(formatChinaMinute(date.toISOString()));
}

function chinaWeekday(date: Date): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short"
  }).format(date);
  return new Map([
    ["Mon", 1],
    ["Tue", 2],
    ["Wed", 3],
    ["Thu", 4],
    ["Fri", 5],
    ["Sat", 6],
    ["Sun", 7]
  ]).get(value) ?? 0;
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
