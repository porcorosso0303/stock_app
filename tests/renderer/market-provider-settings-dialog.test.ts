import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("market provider settings dialog", () => {
  it("renders an independent data source settings dialog", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");

    expect(html).toContain('id="market-provider-dialog"');
    expect(html).toContain('id="market-provider-select"');
    expect(html).toContain("东方财富");
    expect(html).toContain("模拟数据");
    expect(dom).toContain('marketProviderDialog: getElement<HTMLDialogElement>("market-provider-dialog")');
    expect(dom).toContain('marketProviderSelect: getElement<HTMLSelectElement>("market-provider-select")');
    expect(html).toContain('id="watch-news-settings-dialog"');
    expect(html).toContain('id="watch-news-interval-hours"');
    expect(dom).toContain('watchNewsSettingsDialog: getElement<HTMLDialogElement>("watch-news-settings-dialog")');
    expect(dom).toContain('watchNewsIntervalHours: getElement<HTMLInputElement>("watch-news-interval-hours")');
  });

  it("opens the data source dialog from menu events and saves through the provider API", async () => {
    const ipc = await readFile("src/shared/ipc.ts", "utf8");
    const preload = await readFile("src/preload/index.ts", "utf8");
    const main = await readFile("src/renderer/main.ts", "utf8");

    expect(ipc).toContain('openWatchMarketProviderSettings: "watch-market-provider:open-settings"');
    expect(ipc).toContain("setWatchMarketProvider");
    expect(preload).toContain("onOpenWatchMarketProviderSettings");
    expect(preload).toContain("setWatchMarketProvider");
    expect(main).toContain("bindMarketProviderSettings");
    expect(main).toContain("api.setWatchMarketProvider");
    expect(ipc).toContain('openWatchNewsSettings: "watch-news-settings:open"');
    expect(ipc).toContain("setWatchNewsSettings");
    expect(preload).toContain("onOpenWatchNewsSettings");
    expect(preload).toContain("setWatchNewsSettings");
    expect(main).toContain("bindWatchNewsSettings");
    expect(main).toContain("api.setWatchNewsSettings");
  });
});
