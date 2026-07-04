import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererElements } from "../../src/renderer/app/dom";
import { createWatchController } from "../../src/renderer/features/watch/watch-controller";
import type { StockResearchApi } from "../../src/shared/ipc";
import type { WatchMarketData, WatchTreeConfig } from "../../src/shared/types";

describe("watch workspace tabs", () => {
  it("renders workspace tab controls in the watch toolbar", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(html).toContain('id="watch-workspace-tabs"');
    expect(html).toContain('id="add-watch-workspace"');
    expect(dom).toContain('watchWorkspaceTabs: getElement<HTMLElement>("watch-workspace-tabs")');
    expect(dom).toContain('addWatchWorkspace: getElement<HTMLButtonElement>("add-watch-workspace")');
    expect(css).toContain(".watch-workspace-tabs");
    expect(css).toContain(".watch-workspace-tab.active");
  });

  it("wires workspace helpers, tab events and Ctrl+A/Ctrl+D shortcuts in the controller", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("ensureWatchWorkspaceConfig");
    expect(controller).toContain("getActiveWatchRoot");
    expect(controller).toContain("appendWatchWorkspace");
    expect(controller).toContain("deleteWatchWorkspace");
    expect(controller).toContain("renameWatchWorkspace");
    expect(controller).toContain("switchWatchWorkspace");
    expect(controller).toContain('event.key.toLowerCase()');
    expect(controller).toContain('key === "a" ? -1 : 1');
    expect(controller).toContain('data-watch-workspace-action="switch"');
    expect(controller).toContain("persistTree(false)");
  });

  describe("controller behavior", () => {
    beforeEach(() => {
      vi.stubGlobal("Element", TestElement);
      vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "workspace-2") });
      vi.stubGlobal("document", { addEventListener: vi.fn() });
      vi.stubGlobal("window", {
        addEventListener: vi.fn(),
        cancelAnimationFrame: vi.fn(),
        requestAnimationFrame: vi.fn(() => 1),
        clearInterval: vi.fn(),
        setInterval: vi.fn(() => 1),
        setTimeout: vi.fn()
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("creates a visible workspace immediately when clicking the add tab button", async () => {
      const { elements, saveWatchTree } = createFixture({
        activeWorkspaceId: "default",
        workspaces: [{ id: "default", name: "默认" }]
      });

      elements.addWatchWorkspace.emit("click");

      await vi.waitFor(() => expect(saveWatchTree).toHaveBeenCalledOnce());
      expect(saveWatchTree.mock.calls[0]?.[0].workspaces).toMatchObject([
        { id: "default", name: "默认" },
        { id: "workspace-2", name: "展示区 2" }
      ]);
      expect(saveWatchTree.mock.calls[0]?.[0].activeWorkspaceId).toBe("workspace-2");
    });
  });
});

interface TestEvent {
  target: TestElement;
  preventDefault(): void;
}

class TestElement {
  value = "";
  hidden = false;
  innerHTML = "";
  textContent = "";
  disabled = false;
  scrollLeft = 0;
  scrollTop = 0;
  dataset: Record<string, string | undefined> = {};
  style = { left: "", top: "" };
  classList = { add: vi.fn(), remove: vi.fn() };
  children: TestElement[] = [];
  showModal = vi.fn();
  close = vi.fn();
  focus = vi.fn();
  remove = vi.fn();

  private readonly listeners = new Map<string, Array<(event: TestEvent) => void>>();

  addEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, target: TestElement = this): void {
    const event: TestEvent = { target, preventDefault: vi.fn() };
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  closest<T>(): T | null {
    return null;
  }

  querySelector<T>(): T | null {
    return null;
  }

  querySelectorAll<T>(): T[] {
    return [];
  }

  hasPointerCapture(): boolean {
    return false;
  }

  setPointerCapture(): void {}

  releasePointerCapture(): void {}
}

const emptyMarketData: WatchMarketData = {
  quotes: [],
  trends: [],
  updatedAt: "2026-07-04T00:00:00.000Z",
  fromCache: false
};

function createFixture(config: WatchTreeConfig): {
  elements: Record<string, TestElement>;
  saveWatchTree: ReturnType<typeof vi.fn<(config: WatchTreeConfig) => Promise<WatchTreeConfig>>>;
} {
  const elements = createElements();
  const saveWatchTree = vi.fn(async (nextConfig: WatchTreeConfig) => nextConfig);
  const controller = createWatchController({
    api: createApi(saveWatchTree),
    elements: elements as unknown as RendererElements,
    isActive: () => false
  });
  controller.hydrate(config);
  controller.bindEvents();
  return { elements, saveWatchTree };
}

function createElements(): Record<string, TestElement> {
  return Object.fromEntries([
    "refreshWatchQuotes",
    "exportWatchData",
    "importWatchData",
    "watchStatus",
    "watchWorkspaceTabs",
    "addWatchWorkspace",
    "watchTradingDate",
    "watchMarketError",
    "watchPanel",
    "watchTree",
    "watchContextMenu",
    "watchNodeDialog",
    "watchNodeForm",
    "watchNodeDialogTitle",
    "watchNodeType",
    "watchNodeName",
    "searchWatchStock",
    "watchStockResults",
    "watchNodeSecidLabel",
    "watchNodeSecid",
    "watchNodeIndustryPositionLabel",
    "watchNodeIndustryPosition",
    "watchNodeHoldingLabel",
    "watchNodeHolding",
    "watchNodeError",
    "cancelWatchNode"
  ].map((key) => [key, new TestElement()]));
}

function createApi(
  saveWatchTree: (config: WatchTreeConfig) => Promise<WatchTreeConfig>
): StockResearchApi {
  return {
    getBootstrap: async () => ({
      config: {},
      history: [],
      codex: { available: false, message: "Unavailable in controller tests" },
      watchTree: {}
    }),
    chooseReportDirectory: async () => undefined,
    getResearchSpec: async () => "",
    saveResearchSpec: async () => undefined,
    resetResearchSpec: async () => "",
    startResearch: async (stockName) => ({
      id: "research",
      stockName,
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      status: "running",
      reportMarkdownPath: "",
      eventsPath: "",
      stderrPath: ""
    }),
    cancelResearch: async () => undefined,
    listHistory: async () => [],
    readReport: async () => "",
    openPdf: async () => undefined,
    retryPdf: async (id) => ({
      id,
      stockName: "",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      status: "completed",
      reportMarkdownPath: "",
      eventsPath: "",
      stderrPath: ""
    }),
    redetectCodex: async () => ({ available: false, message: "Unavailable in controller tests" }),
    getWatchTree: async () => ({}),
    saveWatchTree,
    getWatchQuotes: async () => [],
    getWatchMarketData: async () => emptyMarketData,
    refreshWatchMarketData: async () => emptyMarketData,
    searchStocks: async () => [],
    exportWatchData: async () => undefined,
    importWatchData: async () => undefined,
    setWatchMarketProvider: async (watchMarketProviderId) => ({ watchMarketProviderId }),
    onOpenWatchMarketProviderSettings: () => () => undefined,
    onWatchMarketProviderChanged: () => () => undefined,
    onResearchEvent: () => () => undefined
  };
}
