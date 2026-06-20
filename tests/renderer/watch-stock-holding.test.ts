import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { WatchTreeCategoryNode } from "../../src/shared/types";
import { renderWatchTree } from "../../src/renderer/features/watch/watch-view";

describe("watch stock holding highlight", () => {
  it("marks a holding stock name with the holding class", () => {
    const html = renderStock(true);

    expect(html).toContain('class="watch-stock-name is-holding"');
  });

  it("does not mark a normal stock name as holding", () => {
    const html = renderStock();

    expect(html).toContain('class="watch-stock-name"');
    expect(html).not.toContain("is-holding");
  });

  it("uses a bold purple glow scoped to holding stock names", async () => {
    const css = await readFile("src/renderer/styles.css", "utf8");
    const rule = css.match(/\.watch-stock-name\.is-holding strong\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toContain("color: #c51ce0");
    expect(rule).toContain("font-weight: 900");
    expect(rule).toContain("text-shadow: 0 0 2px #fff, 0 0 7px #d83bea99");
  });
});

function renderStock(isHolding?: boolean): string {
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
    trends: new Map(),
    marketHistory: [],
    collapsedNodes: new Set()
  }, () => undefined);

  return container.innerHTML;
}
