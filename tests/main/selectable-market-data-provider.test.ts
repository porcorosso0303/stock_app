import { describe, expect, it, vi } from "vitest";
import { SelectableMarketDataProvider } from "../../src/main/modules/watch/market-data/selectable-market-data-provider";
import type { MarketDataProvider } from "../../src/main/modules/watch/market-data/market-data-provider";

describe("SelectableMarketDataProvider", () => {
  it("delegates market data calls to the selected provider and resets replay providers", async () => {
    const eastMoney = provider("east-money", "东方财富");
    const mock = { ...provider("mock-cache", "模拟数据"), reset: vi.fn() };
    const selector = new SelectableMarketDataProvider([eastMoney, mock], "east-money");

    await selector.listQuotes(["1.600001"]);
    selector.select("mock-cache");
    await selector.listTrends(["1.600001"]);

    expect(eastMoney.listQuotes).toHaveBeenCalledWith(["1.600001"]);
    expect(mock.reset).toHaveBeenCalledOnce();
    expect(mock.listTrends).toHaveBeenCalledWith(["1.600001"]);
    expect(selector.id).toBe("mock-cache");
    expect(selector.label).toBe("模拟数据");
  });
});

function provider(id: MarketDataProvider["id"], label: string): MarketDataProvider {
  return {
    id,
    label,
    listQuotes: vi.fn().mockResolvedValue([]),
    listTrends: vi.fn().mockResolvedValue([]),
    searchStocks: vi.fn().mockResolvedValue([])
  };
}
