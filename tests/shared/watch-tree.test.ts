import { describe, expect, it } from "vitest";
import type { StockQuote, WatchTreeCategoryNode } from "../../src/shared/types";
import {
  appendWatchTreeChild,
  averageChangePercent,
  collectStockSecids,
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
});
