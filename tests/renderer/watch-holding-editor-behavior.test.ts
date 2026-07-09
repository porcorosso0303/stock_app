import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererElements } from "../../src/renderer/app/dom";
import { createWatchController } from "../../src/renderer/features/watch/watch-controller";
import type { StockResearchApi } from "../../src/shared/ipc";
import type {
  WatchMarketData,
  WatchTreeConfig,
  WatchTreeNode
} from "../../src/shared/types";

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
  showModal = vi.fn();
  close = vi.fn();
  focus = vi.fn();

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

  closest<T>(selector: string): T | null {
    return selector === "button[data-watch-menu-action]" && this.dataset.watchMenuAction
      ? this as unknown as T
      : null;
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
  updatedAt: "2026-06-20T00:00:00.000Z",
  fromCache: false
};

describe("watch holding editor behavior", () => {
  beforeEach(() => {
    vi.stubGlobal("Element", TestElement);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "new-stock") });
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

  it("defaults the holding selector to false when adding a stock", () => {
    const { elements } = createFixture(categoryConfig());

    openNodeDialog(elements, "add-stock", "root");

    expect(elements.watchNodeHolding.value).toBe("false");
  });

  it("sets the holding selector to true when editing a held stock", () => {
    const { elements } = createFixture(categoryConfig([stockNode({ isHolding: true })]));

    openNodeDialog(elements, "edit", "stock");

    expect(elements.watchNodeHolding.value).toBe("true");
  });

  it("saves isHolding true when the holding selector is true", async () => {
    const { elements, saveWatchTree } = createFixture(categoryConfig());
    openNodeDialog(elements, "add-stock", "root");
    fillStockForm(elements, "true");

    elements.watchNodeForm.emit("submit");

    await vi.waitFor(() => expect(saveWatchTree).toHaveBeenCalledOnce());
    expect(savedStock(saveWatchTree)).toMatchObject({ isHolding: true });
  });

  it("omits isHolding when the holding selector is false", async () => {
    const { elements, saveWatchTree } = createFixture(categoryConfig());
    openNodeDialog(elements, "add-stock", "root");
    fillStockForm(elements, "false");

    elements.watchNodeForm.emit("submit");

    await vi.waitFor(() => expect(saveWatchTree).toHaveBeenCalledOnce());
    expect(savedStock(saveWatchTree)).not.toHaveProperty("isHolding");
  });
});

function createFixture(config: WatchTreeConfig): {
  elements: Record<string, TestElement>;
  saveWatchTree: ReturnType<typeof vi.fn<(config: WatchTreeConfig) => Promise<WatchTreeConfig>>>;
} {
  const elements = createElements();
  const saveWatchTree = vi.fn(async (nextConfig: WatchTreeConfig) => nextConfig);
  const api = createApi(saveWatchTree);
  const controller = createWatchController({
    api,
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
    "refreshWatchNews",
    "watchPanel",
    "watchTree",
    "watchContextMenu",
    "watchNewsTooltip",
    "watchNewsHistoryPanel",
    "watchNewsHistoryHeader",
    "watchNewsHistoryTitle",
    "watchNewsHistoryContent",
    "closeWatchNewsHistory",
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
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
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
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
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
    analyzeWatchStockNews: async () => ({ stockCount: 1, newMessageCount: 0, messages: [], errors: [] }),
    analyzeHoldingWatchNews: async () => ({ stockCount: 0, newMessageCount: 0, messages: [], errors: [] }),
    listWatchNews: async () => [],
    markWatchNewsRead: async () => [],
    getWatchNewsSettings: async () => ({ intervalHours: 3 }),
    setWatchNewsSettings: async (settings) => ({ watchNewsIntervalHours: settings.intervalHours }),
    setWatchMarketProvider: async (watchMarketProviderId) => ({ watchMarketProviderId }),
    onOpenWatchNewsSettings: () => () => undefined,
    onOpenWatchMarketProviderSettings: () => () => undefined,
    onWatchMarketProviderChanged: () => () => undefined,
    onWatchNewsUpdated: () => () => undefined,
    onResearchEvent: () => () => undefined
  };
}

function categoryConfig(children: WatchTreeNode[] = []): WatchTreeConfig {
  return {
    root: {
      id: "root",
      type: "category",
      name: "Root",
      children
    }
  };
}

function stockNode(overrides: Partial<Extract<WatchTreeNode, { type: "stock" }>> = {}): WatchTreeNode {
  return {
    id: "stock",
    type: "stock",
    name: "Test Stock",
    secid: "1.600000",
    ...overrides
  };
}

function openNodeDialog(
  elements: Record<string, TestElement>,
  action: "add-stock" | "edit",
  id: string
): void {
  const button = new TestElement();
  button.dataset.watchMenuAction = action;
  button.dataset.watchId = id;
  elements.watchContextMenu.emit("click", button);
}

function fillStockForm(elements: Record<string, TestElement>, isHolding: "true" | "false"): void {
  elements.watchNodeName.value = "New Stock";
  elements.watchNodeSecid.value = "1.600000";
  elements.watchNodeHolding.value = isHolding;
}

function savedStock(
  saveWatchTree: ReturnType<typeof vi.fn<(config: WatchTreeConfig) => Promise<WatchTreeConfig>>>
): Extract<WatchTreeNode, { type: "stock" }> {
  const savedConfig = saveWatchTree.mock.calls[0]?.[0];
  const node = savedConfig?.root?.children[0];
  if (node?.type !== "stock") {
    throw new Error("Expected saveWatchTree to receive a stock child");
  }
  return node;
}
