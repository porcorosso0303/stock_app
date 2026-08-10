import { describe, expect, it, vi } from "vitest";
import { EastMoneyQuoteService } from "../../src/main/east-money-quote-service";

describe("EastMoneyQuoteService", () => {
  it("maps scaled quote values and removes duplicate secids", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          f43: 130722,
          f58: "贵州茅台",
          f170: -18,
          f8: 72,
          f115: 2540,
          f117: 194000000000
        }
      })
    });
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-06-02T00:00:00.000Z")
    );

    await expect(service.listQuotes(["1.600519", "1.600519"])).resolves.toEqual([{
      secid: "1.600519",
      stockName: "贵州茅台",
      price: 1307.22,
      changePercent: -0.18,
      peTtm: 25.4,
      turnoverRate: 0.72,
      floatMarketCap: 194000000000,
      fetchedAt: "2026-06-02T00:00:00.000Z"
    }]);
    const requestUrl = new URL(fetchImpl.mock.calls[0][0]);
    expect(requestUrl.searchParams.get("fields")).toContain("f8");
    expect(requestUrl.searchParams.get("fields")).toContain("f115");
    expect(requestUrl.searchParams.get("fields")).toContain("f117");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns a visible unavailable quote when the endpoint fails", async () => {
    const service = new EastMoneyQuoteService(
      vi.fn().mockRejectedValue(new Error("network unavailable")),
      () => new Date("2026-06-02T00:00:00.000Z")
    );

    await expect(service.listQuotes(["0.300750"])).resolves.toEqual([{
      secid: "0.300750",
      fetchedAt: "2026-06-02T00:00:00.000Z",
      errorMessage: "network unavailable"
    }]);
  });

  it("aborts a hanging request and returns a visible timeout error", async () => {
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-06-22T10:10:00.000Z"),
      { requestTimeoutMs: 5 }
    );

    await expect(service.listQuotes(["1.603986"])).resolves.toEqual([{
      secid: "1.603986",
      fetchedAt: "2026-06-22T10:10:00.000Z",
      errorMessage: "行情请求超时"
    }]);
  });

  it("limits concurrent requests to avoid exhausting the system proxy", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchImpl = vi.fn(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeRequests -= 1;
      return {
        ok: true,
        json: async () => ({ data: { f43: 1000, f60: 1000, f170: 0 } })
      };
    });
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-06-22T10:10:00.000Z"),
      { maxConcurrentRequests: 2 }
    );

    await service.listQuotes([
      "1.603986",
      "1.688525",
      "0.001309",
      "1.600487",
      "1.601869"
    ]);

    expect(maxActiveRequests).toBeLessThanOrEqual(2);
  });

  it("returns an unavailable trend when previous close is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          trends: [
            "2026-06-04 14:58,529.00,529.20,529.20,528.88,48,2539680.00,529.150",
            "2026-06-04 14:59,529.31,529.31,529.31,529.31,0,0.00,529.151"
          ]
        }
      })
    });
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-06-04T09:32:00.000Z")
    );

    await expect(service.listTrends(["1.600519"])).resolves.toMatchObject([{
      secid: "1.600519",
      fetchedAt: "2026-06-04T09:32:00.000Z",
      tradingDate: "2026-06-04",
      points: [],
      errorMessage: "分时走势缺少昨收价"
    }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("derives intraday trend change percent from EastMoney previous close", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          prePrice: 492.22,
          trends: [
            "2026-06-04 09:30,487.05,487.05,487.05,487.05,0,0.00,487.050",
            "2026-06-04 15:00,529.31,529.31,529.31,529.31,0,0.00,529.310"
          ]
        }
      })
    });
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-06-04T15:01:00.000Z")
    );

    const [trend] = await service.listTrends(["1.603986"]);

    const requestUrl = new URL(fetchImpl.mock.calls[0][0]);
    expect(requestUrl.searchParams.get("fields1")).toBe("f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13");
    expect(trend.tradingDate).toBe("2026-06-04");
    expect(trend.points[0]).toMatchObject({
      time: "09:30",
      price: 487.05,
      changePercent: expect.closeTo(-1.050, 3)
    });
    expect(trend.points[1]).toMatchObject({
      time: "15:00",
      price: 529.31,
      changePercent: expect.closeTo(7.535, 3)
    });
  });

  it("loads one-minute historical trends for a requested trading date", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          preKPrice: 694.81,
          klines: historicalKlines("2026-07-03", 672.54, 672.97, 677.77)
        }
      })
    });
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-07-04T04:01:00.000Z")
    );

    const [trend] = await service.listTrends(["1.603986"], { tradingDate: "2026-07-03" });

    const requestUrl = new URL(fetchImpl.mock.calls[0][0]);
    expect(requestUrl.pathname).toContain("/api/qt/stock/kline/get");
    expect(requestUrl.searchParams.get("beg")).toBe("20260703");
    expect(requestUrl.searchParams.get("end")).toBe("20260703");
    expect(requestUrl.searchParams.get("klt")).toBe("1");
    expect(trend.tradingDate).toBe("2026-07-03");
    expect(trend.points[0]).toMatchObject({ time: "09:30", price: 672.54 });
    expect(trend.points[0].changePercent).toBeCloseTo(-3.205, 3);
    expect(trend.points[1]).toMatchObject({ time: "09:31", price: 672.97 });
    expect(trend.points[1].changePercent).toBeCloseTo(-3.143, 3);
    expect(trend.points.at(-1)).toMatchObject({ time: "15:00", price: 677.77 });
    expect(trend.points.at(-1)?.changePercent).toBeCloseTo(-2.452, 3);
  });

  it("falls back to the alternate EastMoney history host when the preferred host fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({})
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            preKPrice: 417.05,
            klines: historicalKlines("2026-08-10", 415.43, 415.17, 440.40)
          }
        })
      });
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-08-10T09:00:00.000Z")
    );

    const [trend] = await service.listTrends(["1.603986"], { tradingDate: "2026-08-10" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(fetchImpl.mock.calls[0][0]).hostname).toBe("push2delay.eastmoney.com");
    expect(new URL(fetchImpl.mock.calls[1][0]).hostname).toBe("push2his.eastmoney.com");
    expect(trend.tradingDate).toBe("2026-08-10");
    expect(trend.errorMessage).toBeUndefined();
    expect(trend.points[0]).toMatchObject({ time: "09:30" });
    expect(trend.points[1]).toMatchObject({ time: "09:31" });
    expect(trend.points.at(-1)).toMatchObject({ time: "15:00" });
  });

  it("classifies a requested date without historical data as not found", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: null })
    });
    const service = new EastMoneyQuoteService(
      fetchImpl,
      () => new Date("2026-10-01T08:00:00.000Z")
    );

    await expect(service.listTrends(["1.603986"], { tradingDate: "2026-10-01" })).resolves.toMatchObject([{
      secid: "1.603986",
      tradingDate: "2026-10-01",
      points: [],
      errorKind: "not-found"
    }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("classifies historical trend request failures separately from missing dates", async () => {
    const service = new EastMoneyQuoteService(
      vi.fn().mockRejectedValue(new Error("network unavailable")),
      () => new Date("2026-07-04T04:01:00.000Z")
    );

    await expect(service.listTrends(["1.603986"], { tradingDate: "2026-07-03" })).resolves.toMatchObject([{
      secid: "1.603986",
      tradingDate: "2026-07-03",
      points: [],
      errorMessage: "network unavailable",
      errorKind: "request-failed"
    }]);
  });

  it("searches A-share stocks by name and maps the standard secid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        QuotationCodeTable: {
          Data: [
            {
              Code: "600519",
              Name: "贵州茅台",
              Classify: "AStock",
              QuoteID: "1.600519",
              SecurityTypeName: "沪A"
            },
            {
              Code: "00700",
              Name: "腾讯控股",
              Classify: "HKStock",
              QuoteID: "116.00700"
            },
            {
              Code: "688777",
              Name: "中控技术",
              Classify: "23",
              QuoteID: "1.688777",
              SecurityTypeName: "科创板"
            }
          ]
        }
      })
    });
    const service = new EastMoneyQuoteService(fetchImpl);

    await expect(service.searchStocks("贵州茅台")).resolves.toEqual([{
      secid: "1.600519",
      code: "600519",
      name: "贵州茅台",
      marketName: "沪A"
    }, {
      secid: "1.688777",
      code: "688777",
      name: "中控技术",
      marketName: "科创板"
    }]);
  });

  it("rejects an empty stock search", async () => {
    const service = new EastMoneyQuoteService(vi.fn());

    await expect(service.searchStocks("  ")).rejects.toThrow("股票名称");
  });
});

function historicalKlines(
  tradingDate: string,
  openingPrice: number,
  firstClose: number,
  finalClose: number
): string[] {
  const times = [
    ...minuteRange("09:31", "11:30"),
    ...minuteRange("13:01", "15:00")
  ];
  return times.map((time, index) => {
    const close = index === times.length - 1 ? finalClose : firstClose;
    const open = index === 0 ? openingPrice : close;
    return `${tradingDate} ${time},${open.toFixed(2)},${close.toFixed(2)},${close.toFixed(2)},${close.toFixed(2)},100,10000.00,0.00,0.00,0.00,0.01`;
  });
}

function minuteRange(startTime: string, endTime: string): string[] {
  const toMinute = (time: string): number => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
  };
  const times: string[] = [];
  for (let value = toMinute(startTime); value <= toMinute(endTime); value += 1) {
    const hour = Math.floor(value / 60);
    const minute = value % 60;
    times.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return times;
}
