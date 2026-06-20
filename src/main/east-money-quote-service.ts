import type { StockQuote, StockSearchResult, StockTrend } from "../shared/types";
import { validateSecid } from "../shared/watch-tree";
import {
  calculateChangePercent,
  normalizeIntradayTrendPoints,
  type RawIntradayTrendPoint
} from "./modules/watch/market-data/data-calc-helper";

interface FetchResponseLike {
  ok: boolean;
  json(): Promise<unknown>;
}

type FetchLike = (url: string) => Promise<FetchResponseLike>;

export class EastMoneyQuoteService {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async listQuotes(secids: string[]): Promise<StockQuote[]> {
    return await Promise.all([...new Set(secids)].map((secid) => this.get(secid)));
  }

  async listTrends(secids: string[]): Promise<StockTrend[]> {
    return await Promise.all([...new Set(secids)].map((secid) => this.getTrend(secid)));
  }

  async searchStocks(input: string): Promise<StockSearchResult[]> {
    const query = input.trim();
    if (!query) {
      throw new Error("请输入股票名称");
    }
    const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
    url.searchParams.set("input", query);
    url.searchParams.set("type", "14");
    url.searchParams.set("token", "D43BF722C8E33BDC906FB84D85E326E8");
    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error("股票搜索请求失败");
    }
    return readSearchResults(await response.json());
  }

  private async get(input: string): Promise<StockQuote> {
    const secid = validateSecid(input);
    const fetchedAt = this.now().toISOString();
    try {
      const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
      url.searchParams.set("secid", secid);
      url.searchParams.set("fields", "f43,f57,f58,f60,f170,f8,f115,f117");
      const response = await this.fetchImpl(url.toString());
      if (!response.ok) {
        throw new Error("行情服务请求失败");
      }
      const data = requireQuoteData(await response.json());
      const price = readScaledNumber(data.f43);
      return {
        secid,
        stockName: readString(data.f58),
        price,
        changePercent: readQuoteChangePercent(data, price),
        peTtm: readScaledNumber(data.f115),
        turnoverRate: readScaledNumber(data.f8),
        floatMarketCap: readNumber(data.f117),
        fetchedAt
      };
    } catch (error) {
      return {
        secid,
        fetchedAt,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async getTrend(input: string): Promise<StockTrend> {
    const secid = validateSecid(input);
    const fetchedAt = this.now().toISOString();
    try {
      const url = new URL("https://push2his.eastmoney.com/api/qt/stock/trends2/get");
      url.searchParams.set("secid", secid);
      url.searchParams.set("ndays", "1");
      url.searchParams.set("iscr", "0");
      url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13");
      url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
      const response = await this.fetchImpl(url.toString());
      if (!response.ok) {
        throw new Error("分时走势请求失败");
      }
      const trendData = readTrendData(await response.json(), formatChinaDate(this.now()));
      return {
        secid,
        fetchedAt,
        tradingDate: trendData.tradingDate,
        points: trendData.points,
        errorMessage: trendData.errorMessage
      };
    } catch (error) {
      return {
        secid,
        tradingDate: formatChinaDate(this.now()),
        fetchedAt,
        points: [],
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

function readSearchResults(value: unknown): StockSearchResult[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("股票搜索返回格式错误");
  }
  const table = (value as Record<string, unknown>).QuotationCodeTable;
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    throw new Error("股票搜索返回格式错误");
  }
  const data = (table as Record<string, unknown>).Data;
  if (!Array.isArray(data)) {
    throw new Error("股票搜索返回格式错误");
  }
  return data.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const secid = readString(record.QuoteID);
    const code = readString(record.Code);
    const name = readString(record.Name);
    if (!secid || !isAStockCode(code) || !name) {
      return [];
    }
    try {
      return [{
        secid: validateSecid(secid),
        code,
        name,
        marketName: readString(record.SecurityTypeName)
      }];
    } catch {
      return [];
    }
  });
}

function isAStockCode(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

function requireQuoteData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("行情服务返回格式错误");
  }
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("未找到股票行情");
  }
  return data as Record<string, unknown>;
}

interface TrendData {
  tradingDate: string;
  points: StockTrend["points"];
  errorMessage?: string;
}

function readTrendData(value: unknown, fallbackTradingDate: string): TrendData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("分时走势返回格式错误");
  }
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("未找到分时走势");
  }
  const trends = (data as Record<string, unknown>).trends;
  if (!Array.isArray(trends)) {
    throw new Error("分时走势返回格式错误");
  }
  const rawPoints = trends.flatMap((item): RawIntradayTrendPoint[] => {
    if (typeof item !== "string") {
      return [];
    }
    const fields = item.split(",");
    const time = readTrendTime(fields[0]);
    const price = readTrendPrice(fields[2]);
    return time
      ? [{ time, price }]
      : [];
  });
  const tradingDate = readTrendTradingDate(trends) ?? fallbackTradingDate;
  const previousClose = readTrendPrice((data as Record<string, unknown>).prePrice);
  if (previousClose === undefined) {
    return {
      tradingDate,
      points: [],
      errorMessage: "分时走势缺少昨收价"
    };
  }
  return {
    tradingDate,
    points: normalizeIntradayTrendPoints(rawPoints, previousClose)
  };
}

function readTrendTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = /\b(\d{2}:\d{2})\b/.exec(value);
  return match?.[1];
}

function readTrendTradingDate(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const match = /^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}/.exec(value);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function readTrendPrice(value: unknown): number | undefined {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

function readQuoteChangePercent(
  data: Record<string, unknown>,
  price: number | undefined
): number | undefined {
  const rawChangePercent = readScaledNumber(data.f170);
  if (rawChangePercent !== undefined && rawChangePercent !== 0) {
    return rawChangePercent;
  }
  const previousClose = readScaledNumber(data.f60);
  if (price !== undefined && previousClose !== undefined) {
    return calculateChangePercent(price, previousClose);
  }
  return rawChangePercent;
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readScaledNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value / 100
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
