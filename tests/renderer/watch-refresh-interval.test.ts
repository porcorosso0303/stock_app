import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch refresh interval", () => {
  it("polls watch market data every ten seconds", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("setInterval(() => void refreshQuotes(), 10_000)");
    expect(controller).not.toContain("15_000");
  });

  it("does not overlap polling requests while a market update is still running", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("let marketUpdateInFlight = false");
    expect(controller).toContain("if (marketUpdateInFlight)");
    expect(controller).toContain("marketUpdateInFlight = true");
    expect(controller).toContain("marketUpdateInFlight = false");
  });

  it("checks the latest provider trading day once after activation without changing the polling loop", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");
    const ipc = await readFile("src/shared/ipc.ts", "utf8");
    const preload = await readFile("src/preload/index.ts", "utf8");

    expect(ipc).toContain("forceLatest?: boolean");
    expect(preload).toContain("refreshWatchMarketData: async (secids, options)");
    expect(controller).toContain("void refreshLatestMarketData()");
    expect(controller).toContain("api.refreshWatchMarketData(secids, { forceLatest: true })");
    expect(controller).toContain("elements.watchMarketError.textContent");
    expect(controller).toContain("setInterval(() => void refreshQuotes(), 10_000)");
  });

  it("renders a trading-date selector with a separate error status area", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");
    const styles = await readFile("src/renderer/styles.css", "utf8");

    expect(html).toContain('for="watch-trading-date"');
    expect(html).toContain("数据日期");
    expect(html).toContain('id="watch-trading-date"');
    expect(html).toContain('id="watch-market-error"');
    expect(html).not.toContain("行情缓存时间");
    expect(dom).toContain('watchTradingDate: getElement<HTMLSelectElement>("watch-trading-date")');
    expect(dom).toContain('watchMarketError: getElement<HTMLElement>("watch-market-error")');
    expect(controller).toContain("syncTradingDateOptions");
    expect(controller).toContain("handleTradingDateChange");
    expect(controller).toContain("elements.watchMarketError.textContent");
    expect(styles).toContain(".watch-date-label");
    expect(styles).toContain(".watch-market-error");
    expect(styles).toContain("#b42318");
  });
});
