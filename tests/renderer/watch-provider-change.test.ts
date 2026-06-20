import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch provider change", () => {
  it("exposes provider-change events and refreshes watch data when the data source changes", async () => {
    const ipc = await readFile("src/shared/ipc.ts", "utf8");
    const preload = await readFile("src/preload/index.ts", "utf8");
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(ipc).toContain('watchMarketProviderChanged: "watch-market-provider:changed"');
    expect(ipc).toContain("onWatchMarketProviderChanged");
    expect(preload).toContain("onWatchMarketProviderChanged");
    expect(preload).toContain("ipcRenderer.on(IPC.watchMarketProviderChanged");
    expect(controller).toContain("api.onWatchMarketProviderChanged");
    expect(controller).toContain("void loadMarketData()");
  });
});
