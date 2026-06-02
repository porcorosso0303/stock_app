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

    await expect(service.list(["1.600519", "1.600519"])).resolves.toEqual([{
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

    await expect(service.list(["0.300750"])).resolves.toEqual([{
      secid: "0.300750",
      fetchedAt: "2026-06-02T00:00:00.000Z",
      errorMessage: "network unavailable"
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
            }
          ]
        }
      })
    });
    const service = new EastMoneyQuoteService(fetchImpl);

    await expect(service.search("贵州茅台")).resolves.toEqual([{
      secid: "1.600519",
      code: "600519",
      name: "贵州茅台",
      marketName: "沪A"
    }]);
  });

  it("rejects an empty stock search", async () => {
    const service = new EastMoneyQuoteService(vi.fn());

    await expect(service.search("  ")).rejects.toThrow("股票名称");
  });
});
