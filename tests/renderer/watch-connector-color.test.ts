import { describe, expect, it } from "vitest";
import type { StockQuote, WatchTreeCategoryNode } from "../../src/shared/types";
import { watchConnectorStrokeColor } from "../../src/renderer/features/watch/watch-connectors";
import { renderWatchTree } from "../../src/renderer/features/watch/watch-view";

describe("watch connector colors", () => {
  it("maps connector trend kinds to red, green and gray strokes", () => {
    expect(watchConnectorStrokeColor("positive")).toBe("#e3483b");
    expect(watchConnectorStrokeColor("negative")).toBe("#169b62");
    expect(watchConnectorStrokeColor("neutral")).toBe("#789095");
  });

  it("marks stock nodes with connector trend data from their own change percent", () => {
    const html = renderTree(tree([
      stock("up", "上涨股", "1.600001"),
      stock("down", "下跌股", "1.600002"),
      stock("flat", "平盘股", "1.600003")
    ]), [
      quote("1.600001", 1.2),
      quote("1.600002", -0.8),
      quote("1.600003", 0)
    ]);

    expect(html).toContain('data-watch-node-id="up"');
    expect(html).toContain('data-watch-connector-trend="positive"');
    expect(html).toContain('data-watch-node-id="down"');
    expect(html).toContain('data-watch-connector-trend="negative"');
    expect(html).toContain('data-watch-node-id="flat"');
    expect(html).toContain('data-watch-connector-trend="neutral"');
  });

  it("marks category nodes with connector trend data from their average descendant change percent", () => {
    const html = renderTree(tree([
      {
        id: "category-up",
        type: "category",
        name: "上涨分类",
        children: [
          stock("up-a", "上涨 A", "1.600001"),
          stock("up-b", "上涨 B", "1.600002")
        ]
      },
      {
        id: "category-down",
        type: "category",
        name: "下跌分类",
        children: [
          stock("down-a", "下跌 A", "1.600003"),
          stock("down-b", "下跌 B", "1.600004")
        ]
      }
    ]), [
      quote("1.600001", 2),
      quote("1.600002", 1),
      quote("1.600003", -1),
      quote("1.600004", -2)
    ]);

    expect(html).toContain('data-watch-node-id="category-up"');
    expect(html).toContain('data-watch-connector-trend="positive"');
    expect(html).toContain('data-watch-node-id="category-down"');
    expect(html).toContain('data-watch-connector-trend="negative"');
  });
});

function renderTree(root: WatchTreeCategoryNode, quotes: StockQuote[]): string {
  const container = { innerHTML: "" } as HTMLElement;
  renderWatchTree(container, {
    config: { root },
    quotes: new Map(quotes.map((value) => [value.secid, value])),
    trends: new Map(),
    marketHistory: [],
    collapsedNodes: new Set()
  }, () => undefined);
  return container.innerHTML;
}

function tree(children: WatchTreeCategoryNode["children"]): WatchTreeCategoryNode {
  return {
    id: "root",
    type: "category",
    name: "根分类",
    children
  };
}

function stock(id: string, name: string, secid: string): WatchTreeCategoryNode["children"][number] {
  return {
    id,
    type: "stock",
    name,
    secid
  };
}

function quote(secid: string, changePercent: number): StockQuote {
  return {
    secid,
    fetchedAt: "2026-07-04T04:00:00.000Z",
    changePercent
  };
}
