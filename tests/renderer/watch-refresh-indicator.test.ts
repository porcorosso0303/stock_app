import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch market refresh indicator", () => {
  it("renders a hidden compact indicator in a fixed toolbar heading row", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const css = await readFile("src/renderer/styles.css", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");

    expect(html).toContain('class="watch-toolbar-heading-row"');
    expect(html).toContain('id="watch-refresh-indicator"');
    expect(html).toContain('class="watch-refresh-indicator" hidden');
    expect(html).toContain("⏳ 刷新中..");
    expect(html).toContain('aria-live="polite"');
    const heading = html.match(/<div class="watch-toolbar-heading-row">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(heading).not.toContain('id="watch-status"');
    expect(html).toContain('<strong id="watch-status" class="watch-status-line"></strong>');
    expect(dom).toContain('watchRefreshIndicator: getElement<HTMLElement>("watch-refresh-indicator")');
    expect(css).toContain(".watch-toolbar-heading-row");
    expect(css).toMatch(/\.watch-toolbar-heading-row \{[^}]*min-height: 18px;/);
    expect(css).toContain(".watch-refresh-indicator[hidden] { display: none; }");
    expect(css).toMatch(/\.watch-status-line \{[^}]*min-height: 16px;/);
  });

  it("toggles the dedicated indicator around every guarded market update", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("function setMarketRefreshing(refreshing: boolean)");
    expect(controller).toContain("elements.watchRefreshIndicator.hidden = !refreshing");
    expect(controller.match(/setMarketRefreshing\(true\)/g)).toHaveLength(2);
    expect(controller.match(/finally \{\s+setMarketRefreshing\(false\);\s+marketUpdateInFlight = false;/g))
      .toHaveLength(2);
    expect(controller).not.toContain("elements.watchStatus.textContent = loadingMessage");
    expect(controller).not.toContain('"正在刷新行情..."');
  });
});
