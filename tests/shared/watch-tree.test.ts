import { describe, expect, it } from "vitest";
import type { StockQuote, WatchTreeCategoryNode } from "../../src/shared/types";
import {
  appendWatchTreeChild,
  averageChangePercent,
  categoryStrengthHistory,
  categoryStrengthIndex,
  collectStockSecids,
  countUpDownStocks,
  formatTrendPercentClass,
  mergeQuoteIntoTrend,
  normalizeTrendSegments,
  renderTrendSparklineSvg,
  removeWatchTreeNode,
  sortWatchChildrenByChangePercent,
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
    expect(countUpDownStocks(root, quotes)).toEqual({ up: 1, down: 1 });
  });

  it("counts up and down stocks across nested category leaves", () => {
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
      }],
      ["0.000001", {
        secid: "0.000001",
        fetchedAt: "",
        changePercent: 0
      }]
    ]);
    const tree = appendWatchTreeChild(root, "software", {
      id: "flat",
      type: "stock",
      name: "平盘股",
      secid: "0.000001"
    });

    expect(countUpDownStocks(tree, quotes)).toEqual({ up: 1, down: 1 });
  });

  it("calculates the category strength index across nested category leaves", () => {
    const quotes = new Map<string, StockQuote>([
      ["1.600519", {
        secid: "1.600519",
        fetchedAt: "",
        changePercent: 10
      }],
      ["0.300750", {
        secid: "0.300750",
        fetchedAt: "",
        changePercent: 4
      }]
    ]);

    const result = categoryStrengthIndex(root, quotes);

    expect(result.total).toBe(2);
    expect(result.limitUp).toBe(1);
    expect(result.score).toBe(100);
  });

  it("builds category strength history points from market cache days", () => {
    const history = categoryStrengthHistory(root, [{
      tradingDate: "2026-06-06",
      updatedAt: "",
      quotes: [
        { secid: "1.600519", fetchedAt: "", changePercent: -10 },
        { secid: "0.300750", fetchedAt: "", changePercent: -4 }
      ],
      trends: []
    }, {
      tradingDate: "2026-06-05",
      updatedAt: "",
      quotes: [
        { secid: "1.600519", fetchedAt: "", changePercent: 10 },
        { secid: "0.300750", fetchedAt: "", changePercent: 4 }
      ],
      trends: []
    }]);

    expect(history.map((point) => point.tradingDate)).toEqual(["2026-06-05", "2026-06-06"]);
    expect(history[0].score).toBe(100);
    expect(history[1].score).toBe(-100);
  });

  it("sorts direct stock children by current change percent for display", () => {
    const tree: WatchTreeCategoryNode = {
      id: "root",
      type: "category",
      name: "分类",
      children: [
        { id: "down", type: "stock", name: "下跌", secid: "1.600001" },
        { id: "missing", type: "stock", name: "无行情", secid: "1.600004" },
        { id: "up", type: "stock", name: "上涨", secid: "1.600002" },
        { id: "flat", type: "stock", name: "平盘", secid: "1.600003" }
      ]
    };
    const quotes = new Map<string, StockQuote>([
      ["1.600001", { secid: "1.600001", fetchedAt: "", changePercent: -2 }],
      ["1.600002", { secid: "1.600002", fetchedAt: "", changePercent: 5 }],
      ["1.600003", { secid: "1.600003", fetchedAt: "", changePercent: 0 }]
    ]);

    expect(sortWatchChildrenByChangePercent(tree, quotes).map((child) => child.id))
      .toEqual(["up", "flat", "down", "missing"]);
    expect(tree.children.map((child) => child.id))
      .toEqual(["down", "missing", "up", "flat"]);
  });

  it("adds and removes nodes without mutating the original tree", () => {
    const child = { id: "three", type: "stock" as const, name: "股票三", secid: "0.000001" };
    const appended = appendWatchTreeChild(root, "software", child);
    const removed = removeWatchTreeNode(appended, "software");

    expect(collectStockSecids(appended)).toEqual(["1.600519", "0.000001", "0.300750"]);
    expect(collectStockSecids(removed)).toEqual(["0.300750"]);
    expect(collectStockSecids(root)).toEqual(["1.600519", "0.300750"]);
  });

  it("rejects stock top-level nodes, duplicate ids and invalid secids", () => {
    expect(() => validateWatchTreeConfig({
      root: { id: "one", type: "stock", name: "股票", secid: "1.600519" }
    })).toThrow("顶层节点");
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

  it("validates optional stock industry position settings", () => {
    expect(validateWatchTreeConfig({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          industryPosition: "leader1"
        }]
      }
    })).toEqual({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          industryPosition: "leader1"
        }]
      }
    });
    expect(() => validateWatchTreeConfig({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          industryPosition: "leader4"
        }]
      }
    })).toThrow("行业地位");
  });

  it("preserves holding status on stock nodes", () => {
    expect(validateWatchTreeConfig({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          isHolding: true
        }]
      }
    })).toEqual({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          isHolding: true
        }]
      }
    });
  });

  it("omits false holding status from stock nodes", () => {
    expect(validateWatchTreeConfig({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          isHolding: false
        }]
      }
    })).toEqual({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519"
        }]
      }
    });
  });

  it("omits undefined holding status from stock nodes", () => {
    expect(validateWatchTreeConfig({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          isHolding: undefined
        }]
      }
    })).toEqual({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519"
        }]
      }
    });
  });

  it("rejects non-boolean holding status on stock nodes", () => {
    expect(() => validateWatchTreeConfig({
      root: {
        id: "root",
        type: "category",
        name: "分类",
        children: [{
          id: "stock",
          type: "stock",
          name: "股票",
          secid: "1.600519",
          isHolding: "yes"
        }]
      }
    })).toThrow("持仓股");
  });

  it("merges the latest quote into a trend without duplicating fetchedAt minutes", () => {
    const trend = {
      secid: "1.600519",
      tradingDate: "2026-06-04",
      fetchedAt: "2026-06-04T01:30:00.000Z",
      points: [{ time: "09:30", changePercent: -0.5 }]
    };

    expect(mergeQuoteIntoTrend(trend, {
      secid: "1.600519",
      fetchedAt: "2026-06-04T01:31:00.000Z",
      changePercent: 1.2
    })).toEqual({
      secid: "1.600519",
      tradingDate: "2026-06-04",
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
      tradingDate: "2026-06-04",
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

  it("does not inject a quote point into a completed trend that already has later points", () => {
    const trend = {
      secid: "1.600519",
      tradingDate: "2026-06-05",
      fetchedAt: "2026-06-05T07:00:00.000Z",
      points: [
        { time: "10:49", price: 515.03, changePercent: -2.7 },
        { time: "10:51", price: 515.2, changePercent: -2.67 },
        { time: "15:00", price: 488, changePercent: -7.8 }
      ]
    };

    expect(mergeQuoteIntoTrend(trend, {
      secid: "1.600519",
      fetchedAt: "2026-06-06T02:50:00.000Z",
      price: 488,
      changePercent: -7.8
    }).points).toEqual(trend.points);
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

  it("places intraday trend points on a fixed full-day time axis", () => {
    const openingSegments = normalizeTrendSegments([
      { time: "09:30", changePercent: 0 },
      { time: "09:31", changePercent: 1 }
    ], 120, 40);
    const fullDaySegments = normalizeTrendSegments([
      { time: "09:30", changePercent: 0 },
      { time: "15:00", changePercent: 1 }
    ], 120, 40);

    expect(openingSegments[0].path).toBe("M 0 20 L 0.5 2");
    expect(fullDaySegments[0].path).toBe("M 0 20 L 120 2");
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
