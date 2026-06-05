import type { StockQuote, StockSearchResult, StockTrend } from "../shared/types";
import { validateSecid } from "../shared/watch-tree";

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

  async list(secids: string[]): Promise<StockQuote[]> {
    return await Promise.all([...new Set(secids)].map((secid) => this.get(secid)));
  }

  async trends(secids: string[]): Promise<StockTrend[]> {
    return await Promise.all([...new Set(secids)].map((secid) => this.getTrend(secid)));
  }

  async search(input: string): Promise<StockSearchResult[]> {
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
      url.searchParams.set("fields", "f43,f57,f58,f170");
      const response = await this.fetchImpl(url.toString());
      if (!response.ok) {
        throw new Error("行情服务请求失败");
      }
      const data = requireQuoteData(await response.json());
      return {
        secid,
        stockName: readString(data.f58),
        price: readScaledNumber(data.f43),
        changePercent: readScaledNumber(data.f170),
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
      url.searchParams.set("fields1", "f1,f2,f3");
      url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
      const response = await this.fetchImpl(url.toString());
      if (!response.ok) {
        throw new Error("分时走势请求失败");
      }
      return {
        secid,
        fetchedAt,
        points: readTrendPoints(await response.json())
      };
    } catch (error) {
      return {
        secid,
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

function readTrendPoints(value: unknown): StockTrend["points"] {
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
  return trends.flatMap((item) => {
    if (typeof item !== "string") {
      return [];
    }
    const fields = item.split(",");
    const time = readTrendTime(fields[0]);
    const price = readTrendPrice(fields[2]);
    return time && price !== undefined
      ? [{ time, price, changePercent: 0 }]
      : [];
  });
}

function readTrendTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = /\b(\d{2}:\d{2})\b/.exec(value);
  return match?.[1];
}

function readTrendPrice(value: string | undefined): number | undefined {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readScaledNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value / 100
    : undefined;
}
