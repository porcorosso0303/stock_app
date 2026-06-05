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
    const source = await readFile("src/renderer/main.ts", "utf8");

    expect(source).toContain('elements.watchPanel.addEventListener("contextmenu", handleWatchPanelContextMenu);');
    expect(source).toContain('data-watch-menu-action="create-category"');
    expect(source).toContain('openWatchNodeDialog({ kind: "create-category" });');
    expect(source).not.toContain("watchConfiguring");
    expect(source).not.toContain("toggleWatchConfig");
  });

  it("keeps the empty state to a single hint without the unconfigured title", async () => {
    const source = await readFile("src/renderer/main.ts", "utf8");

    expect(source).not.toContain("尚未配置盯盘脑图");
    expect(source).toContain("在空白区域点击鼠标右键创建分类。");
    expect(source).not.toContain("根分类");
  });
});
