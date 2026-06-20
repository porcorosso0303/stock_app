import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { WatchTreeCategoryNode } from "../../src/shared/types";
import { renderWatchTree } from "../../src/renderer/features/watch/watch-view";

describe("watch stock holding highlight", () => {
  it("marks a holding stock name with the holding class", () => {
    const html = renderStock(true);

    expect(html).toContain('class="watch-stock-name is-holding"');
  });

  it("renders accessible holding status without replacing the sudden-move label", () => {
    const html = renderStock(true, true);

    expect(html).toContain('<span class="watch-visually-hidden">持仓股</span>');
    expect(html).toContain("持仓状态：持仓股");
    expect(html).toContain('aria-label="异动上涨"');
  });

  it("does not mark a normal stock name as holding", () => {
    const html = renderStock();

    expect(html).toContain('class="watch-stock-name"');
    expect(html).not.toContain("is-holding");
    expect(html).not.toContain("watch-visually-hidden");
    expect(html).not.toContain("持仓股");
  });

  it("uses a clipping-safe bold purple glow scoped to holding stock names", async () => {
    const css = await readFile("src/renderer/styles.css", "utf8");
    const holdingRule = cssDeclarations(css, ".watch-stock-name.is-holding strong");
    const truncationRule = cssDeclarations(css, ".watch-node.stock .watch-stock-name strong");

    expect(holdingRule.get("color")).toBe("#c51ce0");
    expect(Number(holdingRule.get("font-weight"))).toBeGreaterThanOrEqual(800);
    expect(holdingRule.get("text-shadow")).toMatch(/#fff(?:fff)?/i);
    expect(holdingRule.get("filter")).toMatch(/drop-shadow\([^)]*#d83bea(?:99)?/i);
    expect(truncationRule.get("overflow")).toBe("hidden");
    expect(truncationRule.get("text-overflow")).toBe("ellipsis");
  });

  it("defines a reusable visually hidden treatment", async () => {
    const css = await readFile("src/renderer/styles.css", "utf8");
    const rule = cssDeclarations(css, ".watch-visually-hidden");

    expect(rule.get("position")).toBe("absolute");
    expect(rule.get("width")).toBe("1px");
    expect(rule.get("height")).toBe("1px");
    expect(rule.get("overflow")).toBe("hidden");
    expect(rule.get("clip")).toMatch(/^rect\(/);
  });
});

function renderStock(isHolding?: boolean, withSuddenMove = false): string {
  const container = { innerHTML: "" } as HTMLElement;
  const root: WatchTreeCategoryNode = {
    id: "root",
    type: "category",
    name: "分类",
    children: [{
      id: "stock",
      type: "stock",
      name: "测试股",
      secid: "1.600001",
      ...(isHolding ? { isHolding: true } : {})
    }]
  };

  renderWatchTree(container, {
    config: { root },
    quotes: new Map(),
    trends: new Map(withSuddenMove ? [["1.600001", {
      secid: "1.600001",
      tradingDate: "2026-06-20",
      fetchedAt: "2026-06-20T02:00:00.000Z",
      points: [
        { time: "09:30", changePercent: 0.2 },
        { time: "09:34", changePercent: 1.7 }
      ]
    }]] : []),
    marketHistory: [],
    collapsedNodes: new Set()
  }, () => undefined);

  return container.innerHTML;
}

function cssDeclarations(css: string, selector: string): Map<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  return new Map(body.split(";").flatMap((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 0) {
      return [];
    }
    return [[
      declaration.slice(0, separator).trim(),
      declaration.slice(separator + 1).trim()
    ]];
  }));
}
