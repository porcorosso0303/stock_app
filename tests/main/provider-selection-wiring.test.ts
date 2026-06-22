import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch provider selection wiring", () => {
  it("wires selectable providers, menu selection, and renderer notifications in main", async () => {
    const source = await readFile("src/main/index.ts", "utf8");

    expect(source).toContain("buildApplicationMenuTemplate");
    expect(source).toContain("SelectableMarketDataProvider");
    expect(source).toContain("MockCacheMarketDataProvider");
    expect(source).toContain("setWatchMarketProviderId");
    expect(source).toContain("Menu.setApplicationMenu");
    expect(source).toContain("IPC.watchMarketProviderChanged");
  });

  it("uses the abortable Electron network adapter for EastMoney", async () => {
    const source = await readFile("src/main/index.ts", "utf8");

    expect(source).toMatch(/import\s*\{[\s\S]*\bnet\b[\s\S]*\}\s*from\s*"electron"/);
    expect(source).toContain("createElectronNetFetch");
    expect(source).toContain("new EastMoneyMarketDataProvider(createElectronNetFetch(net))");
    expect(source).not.toContain("net.fetch");
  });
});
