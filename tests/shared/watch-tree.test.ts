import { describe, expect, it } from "vitest";
import type { StockQuote, WatchTreeCategoryNode } from "../../src/shared/types";
import {
  appendWatchTreeChild,
  averageChangePercent,
  collectStockSecids,
  formatTrendPercentClass,
  mergeQuoteIntoTrend,
  normalizeTrendSegments,
  renderTrendSparklineSvg,
  removeWatchTreeNode,
  validateWatchTreeConfig
} from "../../src/shared/watch-tree";

const root: WatchTreeCategoryNode = {
  id: "tech",
  type: "category",
  name: "科技股",
  children: [
    {
      id: "software",
      type: "category",
      name: "软件",
      children: [
        { id: "one", type: "stock", name: "股票一", secid: "1.600519" }
      ]
    },
    { id: "two", type: "stock", name: "股票二", secid: "0.300750" }
  ]
};

describe("watch tree", () => {
  it("collects leaf secids and calculates the available leaf average", () => {
    const quotes = new Map<string, StockQuote>([
      ["1.600519", {
        secid: "1.600519",
        fetchedAt: "",
        changePercent: 2
      }],
      ["0.300750", {
        secid: "0.300750",
        fetchedAt: "",
        changePercent: -1
      }]
    ]);

    expect(collectStockSecids(root)).toEqual(["1.600519", "0.300750"]);
    expect(averageChangePercent(root, quotes)).toBe(0.5);
  });

  it("adds and removes nodes without mutating the original tree", () => {
    const child = { id: "three", type: "stock" as const, name: "股票三", secid: "0.000001" };
    const appended = appendWatchTreeChild(root, "software", child);
    const removed = removeWatchTreeNode(appended, "software");

    expect(collectStockSecids(appended)).toEqual(["1.600519", "0.000001", "0.300750"]);
    expect(collectStockSecids(removed)).toEqual(["0.300750"]);
    expect(collectStockSecids(root)).toEqual(["1.600519", "0.300750"]);
  });

  it("rejects stock roots, duplicate ids and invalid secids", () => {
    expect(() => validateWatchTreeConfig({
      root: { id: "one", type: "stock", name: "股票", secid: "1.600519" }
    })).toThrow("根节点");
    expect(() => validateWatchTreeConfig({
      root: {
        id: "same",
        type: "category",
        name: "分类",
        children: [{ id: "same", type: "stock", name: "股票", secid: "1.600519" }]
      }
    })).toThrow("重复");
    expect(() => validateWatchTreeConfig({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{ id: "stock", type: "stock", name: "股票", secid: "600519" }]
      }
    })).toThrow("secid");
  });

  it("merges the latest quote into a trend without duplicating fetchedAt minutes", () => {
    const trend = {
      secid: "1.600519",
      fetchedAt: "2026-06-04T01:30:00.000Z",
      points: [{ time: "09:30", changePercent: -0.5 }]
    };

    expect(mergeQuoteIntoTrend(trend, {
      secid: "1.600519",
      fetchedAt: "2026-06-04T01:31:00.000Z",
      changePercent: 1.2
    })).toEqual({
      secid: "1.600519",
      fetchedAt: "2026-06-04T01:31:00.000Z",
      points: [
        { time: "09:30", changePercent: -0.5 },
        { time: "09:31", changePercent: 1.2 }
      ]
    });

    expect(mergeQuoteIntoTrend(trend, {
      secid: "1.600519",
      fetchedAt: "2026-06-04T01:30:20.000Z",
      changePercent: 0.8
    }).points).toEqual([{ time: "09:30", changePercent: 0.8 }]);
  });

  it("does not append quote points outside China trading hours", () => {
    const trend = {
      secid: "1.600519",
      fetchedAt: "2026-06-04T07:00:00.000Z",
      points: [{ time: "15:00", price: 529.31, changePercent: 7.53 }]
    };

    expect(mergeQuoteIntoTrend(trend, {
      secid: "1.600519",
      fetchedAt: "2026-06-04T10:31:00.000Z",
      price: 529.31,
      changePercent: 7.53
    }).points).toEqual([{ time: "15:00", price: 529.31, changePercent: 7.53 }]);
  });

  it("normalizes positive and negative trend segments around the zero axis", () => {
    const segments = normalizeTrendSegments([
      { time: "09:30", changePercent: -1 },
      { time: "10:00", changePercent: 0.5 },
      { time: "10:30", changePercent: 1 }
    ], 120, 40);

    expect(segments.some((segment) => segment.kind === "negative")).toBe(true);
    expect(segments.some((segment) => segment.kind === "positive")).toBe(true);
    expect(segments.every((segment) => segment.path.startsWith("M "))).toBe(true);
  });

  it("renders the whole sparkline color from the latest change percent", () => {
    const svg = renderTrendSparklineSvg([
      { time: "09:30", changePercent: -1 },
      { time: "10:00", changePercent: 0.5 },
      { time: "10:30", changePercent: 1 }
    ], -0.71);

    expect(svg).toContain("watch-trend-zero-axis");
    expect(svg).toContain("watch-trend-negative");
    expect(svg).not.toContain("watch-trend-positive");

    const positiveSvg = renderTrendSparklineSvg([
      { time: "09:30", changePercent: -1 },
      { time: "10:00", changePercent: 0.5 }
    ], 0.1);
    expect(positiveSvg).toContain("watch-trend-positive");
    expect(positiveSvg).not.toContain("watch-trend-negative");
  });

  it("formats trend percentage classes by sign", () => {
    expect(formatTrendPercentClass(1)).toBe("watch-change-percent positive");
    expect(formatTrendPercentClass(-1)).toBe("watch-change-percent negative");
    expect(formatTrendPercentClass(0)).toBe("watch-change-percent neutral");
    expect(formatTrendPercentClass(undefined)).toBe("watch-change-percent neutral");
  });
});
