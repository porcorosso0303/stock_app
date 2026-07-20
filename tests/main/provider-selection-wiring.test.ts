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
  });

  it("keeps Codex and DeepSeek behind the common research provider boundary", async () => {
    const codex = await readFile("src/main/modules/research/providers/codex-cli-provider.ts", "utf8");
    const deepseek = await readFile("src/main/modules/research/providers/deepseek-provider.ts", "utf8");

    expect(codex).toContain("implements ResearchProvider");
    expect(deepseek).toContain("implements ResearchProvider");
    expect(deepseek).toContain("buildDeepSeekResearchPrompts");
    expect(deepseek).not.toContain("ResearchSkillPreparer");
  });

  it("wires research and watch news through the task-level model provider manager", async () => {
    const source = await readFile("src/main/index.ts", "utf8");

    expect(source).toContain("new ModelProviderManager");
    expect(source).toContain("CodexCliResearchProvider");
    expect(source).toContain("DeepSeekResearchProvider");
    expect(source).toContain("CodexWatchNewsAnalysisProvider");
    expect(source).toContain("DeepSeekWatchNewsAnalysisProvider");
    expect(source).toContain("resolveResearchProvider");
    expect(source).toContain("resolveWatchNewsProvider");
    expect(source).toContain("new TavilyWebTools");
    expect(source).toContain("new DeepSeekAgentRunner");
    expect(source).toContain("createFetchHttpTransport");
  });
});
