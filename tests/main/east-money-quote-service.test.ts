import { describe, expect, it, vi } from "vitest";
import { EastMoneyQuoteService } from "../../src/main/east-money-quote-service";

describe("EastMoneyQuoteService", () => {
  it("maps scaled quote values and removes duplicate secids", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { f43: 130722, f58: "贵州茅台", f170: -18 }
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
      fetchedAt: "2026-06-02T00:00:00.000Z"
    }]);
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

  it("maps intraday trend prices without treating volume as change percent", async () => {
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

    await expect(service.listTrends(["1.600519"])).resolves.toEqual([{
      secid: "1.600519",
      fetchedAt: "2026-06-04T09:32:00.000Z",
      points: [
        { time: "14:58", price: 529.2, changePercent: 0 },
        { time: "14:59", price: 529.31, changePercent: 0 }
      ]
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
