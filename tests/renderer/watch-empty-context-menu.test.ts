import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch empty-space context menu", () => {
  it("removes explicit configuration controls from the watch workspace", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(html).not.toContain("watch-config-bar");
    expect(html).not.toContain("create-watch-root");
    expect(html).not.toContain("toggle-watch-config");
    expect(html).not.toContain("配置脑图");
    expect(css).not.toContain("watch-config-bar");
  });

  it("opens a create-category menu from empty watch panel space without configuration mode", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");
    const contextMenu = await readFile("src/renderer/features/watch/watch-context-menu.ts", "utf8");

    expect(controller).toContain('elements.watchPanel.addEventListener("contextmenu", handlePanelContextMenu);');
    expect(contextMenu).toContain('data-watch-menu-action="create-category"');
    expect(controller).toContain('openNodeDialog({ kind: "create-category" });');
    expect(controller).not.toContain("watchConfiguring");
    expect(controller).not.toContain("toggleWatchConfig");
  });

  it("limits stock news actions to holding stock context menus", async () => {
    const contextMenu = await readFile("src/renderer/features/watch/watch-context-menu.ts", "utf8");

    expect(contextMenu).toContain("node.isHolding");
    expect(contextMenu).toContain('data-watch-menu-action="refresh-news"');
    expect(contextMenu).toContain('data-watch-menu-action="show-news"');
    expect(contextMenu).toContain('data-watch-menu-action="debug-news"');
  });

  it("keeps the empty state to a single hint without the unconfigured title", async () => {
    const source = await readFile("src/renderer/features/watch/watch-view.ts", "utf8");

    expect(source).not.toContain("尚未配置盯盘脑图");
    expect(source).toContain("在空白区域点击鼠标右键创建分类。");
    expect(source).not.toContain("根分类");
  });
});
