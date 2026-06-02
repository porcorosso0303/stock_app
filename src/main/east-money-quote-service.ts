import type { StockQuote, StockSearchResult } from "../shared/types";
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
    if (record.Classify !== "AStock" || !secid || !code || !name) {
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readScaledNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value / 100
    : undefined;
}
