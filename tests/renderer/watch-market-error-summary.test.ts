import { describe, expect, it } from "vitest";
import { summarizeMarketErrors } from "../../src/renderer/features/watch/watch-controller";
import type { StockQuote } from "../../src/shared/types";

function quote(errorMessage?: string): StockQuote {
  return {
    secid: "1.600519",
    fetchedAt: "2026-07-04T04:00:00.000Z",
    errorMessage
  };
}

describe("summarizeMarketErrors", () => {
  it("includes the common failure reason when all unavailable quotes share one error", () => {
    expect(summarizeMarketErrors([
      quote("行情请求超时"),
      quote("行情请求超时")
    ])).toBe("2 只股票暂无行情：行情请求超时");
  });

  it("keeps the aggregate message when unavailable quotes have different errors", () => {
    expect(summarizeMarketErrors([
      quote("行情请求超时"),
      quote("未找到 2026-07-02 行情")
    ])).toBe("2 只股票暂无行情");
  });

  it("returns an empty message when all quotes are usable", () => {
    expect(summarizeMarketErrors([{
      secid: "1.600519",
      fetchedAt: "2026-07-04T04:00:00.000Z",
      changePercent: 1.2
    }])).toBe("");
  });
});
