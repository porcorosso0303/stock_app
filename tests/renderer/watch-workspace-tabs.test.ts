import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererElements } from "../../src/renderer/app/dom";
import { createWatchController } from "../../src/renderer/features/watch/watch-controller";
import type { StockResearchApi } from "../../src/shared/ipc";
import type { WatchMarketData, WatchMarketRequestOptions, WatchTreeConfig } from "../../src/shared/types";

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
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-04T12:00:00+08:00"));
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
      vi.useRealTimers();
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

    it("enters inline rename mode when double-clicking a workspace tab", () => {
      const { elements } = createFixture({
        activeWorkspaceId: "default",
        workspaces: [{ id: "default", name: "默认" }]
      });
      const tab = workspaceButton("default", "switch");

      elements.watchWorkspaceTabs.emit("dblclick", tab);

      expect(elements.watchWorkspaceTabs.innerHTML).toContain("watch-workspace-rename-input");
      expect(elements.watchWorkspaceTabs.innerHTML).toContain('value="默认"');
    });

    it("shows a rename option when right-clicking a workspace tab", () => {
      const { elements } = createFixture({
        activeWorkspaceId: "default",
        workspaces: [{ id: "default", name: "默认" }]
      });
      const tab = workspaceButton("default", "switch");

      const event = elements.watchWorkspaceTabs.emit("contextmenu", tab, { clientX: 20, clientY: 30 });

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(elements.watchContextMenu.innerHTML).toContain('data-watch-menu-action="rename-workspace"');
      expect(elements.watchContextMenu.innerHTML).toContain("重命名");
      expect(elements.watchContextMenu.hidden).toBe(false);
      expect(elements.watchContextMenu.style.left).toBe("20px");
      expect(elements.watchContextMenu.style.top).toBe("30px");
    });

    it("uses the first workspace as active on startup without persisting the active tab", async () => {
      const getWatchMarketData = vi.fn(async () => marketData("2026-07-03"));
      const { controller, saveWatchTree } = createFixture(workspaceConfig("second"), {
        isActive: true,
        getWatchMarketData
      });

      await controller.activate();

      expect(getWatchMarketData).toHaveBeenCalledWith(["1.600001"], undefined);
      expect(saveWatchTree).not.toHaveBeenCalled();
    });

    it("switches workspace tabs without persisting the active tab", async () => {
      const { elements, saveWatchTree } = createFixture(workspaceConfig("default"));

      elements.watchWorkspaceTabs.emit("click", workspaceButton("second", "switch"));

      await Promise.resolve();
      expect(saveWatchTree).not.toHaveBeenCalled();
      expect(elements.watchWorkspaceTabs.innerHTML).toContain('data-watch-workspace-id="second"');
      expect(elements.watchWorkspaceTabs.innerHTML).toContain('aria-selected="true"');
    });

    it("keeps selected trading dates isolated per workspace and does not persist date selection", async () => {
      const getWatchMarketData = vi.fn(async (_secids: string[], options?: WatchMarketRequestOptions) =>
        marketData(options?.tradingDate ?? "2026-07-03")
      );
      const { elements, saveWatchTree } = createFixture(workspaceConfig("default"), {
        isActive: true,
        getWatchMarketData
      });
      elements.watchTradingDate.value = "2026-07-02";

      elements.watchTradingDate.emit("change");
      await vi.waitFor(() => expect(getWatchMarketData).toHaveBeenCalledWith(
        ["1.600001"],
        { tradingDate: "2026-07-02" }
      ));

      elements.watchWorkspaceTabs.emit("click", workspaceButton("second", "switch"));

      await Promise.resolve();
      expect(saveWatchTree).not.toHaveBeenCalled();
      expect(elements.watchTradingDate.value).toBe("2026-07-03");

      elements.watchWorkspaceTabs.emit("click", workspaceButton("default", "switch"));

      await Promise.resolve();
      expect(elements.watchTradingDate.value).toBe("2026-07-02");
    });

    it("keeps rendered market data isolated per workspace while switching tabs", async () => {
      const refreshWatchMarketData = vi.fn(async (secids: string[]) =>
        secids.includes("1.600001")
          ? marketDataWithQuote("1.600001", 1.23)
          : marketDataWithQuote("1.600002", 2.34)
      );
      const { elements } = createFixture(workspaceConfig("default"), {
        isActive: true,
        refreshWatchMarketData
      });

      elements.refreshWatchQuotes.emit("click");
      await vi.waitFor(() => expect(elements.watchTree.innerHTML).toContain("+1.23%"));

      elements.watchWorkspaceTabs.emit("click", workspaceButton("second", "switch"));
      elements.refreshWatchQuotes.emit("click");
      await vi.waitFor(() => expect(elements.watchTree.innerHTML).toContain("+2.34%"));

      elements.watchWorkspaceTabs.emit("click", workspaceButton("default", "switch"));

      expect(elements.watchTree.innerHTML).toContain("+1.23%");
      expect(elements.watchTree.innerHTML).not.toContain("暂无行情");
    });

    it("keeps the previous rendered market data when a later refresh has no usable trends", async () => {
      let defaultRefreshCount = 0;
      const refreshWatchMarketData = vi.fn(async (secids: string[]) => {
        if (!secids.includes("1.600001")) {
          return marketDataWithQuote("1.600002", 2.34);
        }
        defaultRefreshCount += 1;
        return defaultRefreshCount === 1
          ? marketDataWithQuote("1.600001", 1.23)
          : {
              ...marketData("2026-07-07"),
              quotes: [{
                secid: "1.600001",
                fetchedAt: "2026-07-07T03:38:00.000Z",
                errorMessage: "行情服务请求失败"
              }],
              trends: [{
                secid: "1.600001",
                tradingDate: "2026-07-07",
                fetchedAt: "2026-07-07T03:38:00.000Z",
                points: [],
                errorMessage: "net::ERR_EMPTY_RESPONSE"
              }]
            };
      });
      const { elements } = createFixture(workspaceConfig("default"), {
        isActive: true,
        refreshWatchMarketData
      });

      elements.refreshWatchQuotes.emit("click");
      await vi.waitFor(() => expect(elements.watchTree.innerHTML).toContain("+1.23%"));

      elements.refreshWatchQuotes.emit("click");
      await vi.waitFor(() => expect(elements.watchMarketError.textContent).toContain("行情服务请求失败"));

      expect(elements.watchTree.innerHTML).toContain("+1.23%");
      expect(elements.watchTree.innerHTML).not.toContain("暂无行情");
    });

    it("continues refreshing inactive workspace market data", async () => {
      let defaultRefreshCount = 0;
      const refreshWatchMarketData = vi.fn(async (secids: string[]) => {
        if (secids.includes("1.600001")) {
          defaultRefreshCount += 1;
          return marketDataWithQuote("1.600001", defaultRefreshCount === 1 ? 1.23 : 3.45);
        }
        return marketDataWithQuote("1.600002", 2.34);
      });
      const { elements } = createFixture(workspaceConfig("default"), {
        isActive: true,
        refreshWatchMarketData
      });

      elements.refreshWatchQuotes.emit("click");
      await vi.waitFor(() => expect(elements.watchTree.innerHTML).toContain("+1.23%"));

      elements.watchWorkspaceTabs.emit("click", workspaceButton("second", "switch"));
      await Promise.resolve();
      expect(elements.watchTree.innerHTML).toContain("+2.34%");

      elements.refreshWatchQuotes.emit("click");
      await vi.waitFor(() => expect(refreshWatchMarketData).toHaveBeenCalledWith(["1.600001"], { forceLatest: true }));

      elements.watchWorkspaceTabs.emit("click", workspaceButton("default", "switch"));

      expect(elements.watchTree.innerHTML).toContain("+3.45%");
      expect(elements.watchTree.innerHTML).not.toContain("+1.23%");
    });
  });
});

interface TestEvent {
  target: TestElement;
  clientX: number;
  clientY: number;
  key: string;
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

  emit(type: string, target: TestElement = this, init: Partial<TestEvent> = {}): TestEvent {
    const event: TestEvent = {
      target,
      clientX: 0,
      clientY: 0,
      key: "",
      preventDefault: vi.fn(),
      ...init
    };
    this.listeners.get(type)?.forEach((listener) => listener(event));
    return event;
  }

  closest<T>(selector: string): T | null {
    if (
      selector === "button[data-watch-workspace-action]" &&
      this.dataset.watchWorkspaceAction
    ) {
      return this as unknown as T;
    }
    if (
      selector === 'button[data-watch-workspace-action="switch"]' &&
      this.dataset.watchWorkspaceAction === "switch"
    ) {
      return this as unknown as T;
    }
    if (
      selector === "[data-watch-workspace-id]" &&
      this.dataset.watchWorkspaceId
    ) {
      return this as unknown as T;
    }
    if (
      selector === "button[data-watch-menu-action]" &&
      this.dataset.watchMenuAction
    ) {
      return this as unknown as T;
    }
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

function createFixture(config: WatchTreeConfig, options: {
  isActive?: boolean;
  getWatchMarketData?: StockResearchApi["getWatchMarketData"];
  refreshWatchMarketData?: StockResearchApi["refreshWatchMarketData"];
} = {}): {
  controller: ReturnType<typeof createWatchController>;
  elements: Record<string, TestElement>;
  saveWatchTree: ReturnType<typeof vi.fn<(config: WatchTreeConfig) => Promise<WatchTreeConfig>>>;
} {
  const elements = createElements();
  const saveWatchTree = vi.fn(async (nextConfig: WatchTreeConfig) => nextConfig);
  const controller = createWatchController({
    api: createApi(saveWatchTree, options),
    elements: elements as unknown as RendererElements,
    isActive: () => options.isActive ?? false
  });
  controller.hydrate(config);
  controller.bindEvents();
  return { controller, elements, saveWatchTree };
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

function workspaceButton(workspaceId: string, action: string): TestElement {
  const element = new TestElement();
  element.dataset.watchWorkspaceId = workspaceId;
  element.dataset.watchWorkspaceAction = action;
  return element;
}

function createApi(
  saveWatchTree: (config: WatchTreeConfig) => Promise<WatchTreeConfig>,
  options: {
    getWatchMarketData?: StockResearchApi["getWatchMarketData"];
    refreshWatchMarketData?: StockResearchApi["refreshWatchMarketData"];
  } = {}
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
    getWatchMarketData: options.getWatchMarketData ?? (async () => emptyMarketData),
    refreshWatchMarketData: options.refreshWatchMarketData ?? (async () => emptyMarketData),
    searchStocks: async () => [],
    exportWatchData: async () => undefined,
    importWatchData: async () => undefined,
    setWatchMarketProvider: async (watchMarketProviderId) => ({ watchMarketProviderId }),
    onOpenWatchMarketProviderSettings: () => () => undefined,
    onWatchMarketProviderChanged: () => () => undefined,
    onResearchEvent: () => () => undefined
  };
}

function workspaceConfig(activeWorkspaceId: string): WatchTreeConfig {
  return {
    activeWorkspaceId,
    workspaces: [{
      id: "default",
      name: "默认",
      root: {
        id: "root-a",
        type: "category",
        name: "第一组",
        children: [{ id: "stock-a", type: "stock", name: "股票A", secid: "1.600001" }]
      }
    }, {
      id: "second",
      name: "展示区 2",
      root: {
        id: "root-b",
        type: "category",
        name: "第二组",
        children: [{ id: "stock-b", type: "stock", name: "股票B", secid: "1.600002" }]
      }
    }]
  };
}

function marketData(tradingDate: string): WatchMarketData {
  return {
    tradingDate,
    quotes: [],
    trends: [],
    history: [
      { tradingDate: "2026-07-03", quotes: [], trends: [], updatedAt: "2026-07-04T00:00:00.000Z" },
      { tradingDate: "2026-07-02", quotes: [], trends: [], updatedAt: "2026-07-04T00:00:00.000Z" }
    ],
    updatedAt: "2026-07-04T00:00:00.000Z",
    fromCache: false
  };
}

function marketDataWithQuote(secid: string, changePercent: number): WatchMarketData {
  return {
    ...marketData("2026-07-03"),
    quotes: [{
      secid,
      price: 10,
      changePercent,
      peTtm: 20,
      turnoverRate: 1,
      floatMarketCap: 1_000_000_000,
      fetchedAt: "2026-07-04T00:00:00.000Z"
    }],
    trends: [{
      secid,
      tradingDate: "2026-07-03",
      fetchedAt: "2026-07-04T00:00:00.000Z",
      points: [
        { time: "09:30", changePercent: 0 },
        { time: "15:00", changePercent }
      ]
    }]
  };
}
