import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererElements } from "../../src/renderer/app/dom";
import { createWatchController } from "../../src/renderer/features/watch/watch-controller";
import type { StockResearchApi } from "../../src/shared/ipc";
import type {
  WatchMarketData,
  WatchNewsAnalysisResult,
  WatchNewsDebugRun,
  WatchNewsMessage,
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
const intervalCallbacks: Array<() => void> = [];

describe("watch holding editor behavior", () => {
  beforeEach(() => {
    intervalCallbacks.length = 0;
    vi.stubGlobal("Element", TestElement);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "new-stock") });
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      cancelAnimationFrame: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setInterval: vi.fn((callback: () => void) => {
        intervalCallbacks.push(callback);
        return intervalCallbacks.length;
      }),
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

  it("shows the concrete model failure after refreshing one stock's news", async () => {
    const errorMessage = "GPT/Codex 使用额度已耗尽，请在 10:54 PM 后重试";
    const analyzeWatchStockNews = vi.fn(async (): Promise<WatchNewsAnalysisResult> => ({
      stockCount: 1,
      newMessageCount: 0,
      messages: [],
      errors: [{ secid: "1.688777", stockName: "中控技术", errorMessage }]
    }));
    const { elements } = createFixture(
      categoryConfig([stockNode({ name: "中控技术", secid: "1.688777" })]),
      { analyzeWatchStockNews }
    );

    const button = new TestElement();
    button.dataset.watchMenuAction = "refresh-news";
    button.dataset.watchId = "stock";
    elements.watchContextMenu.emit("click", button);

    await vi.waitFor(() => expect(elements.watchStatus.textContent).toContain(errorMessage));
  });

  it("refreshes an open debug window and shows status, raw JSONL and the final report", async () => {
    let readCount = 0;
    const getWatchNewsDebugRun = vi.fn(async (): Promise<WatchNewsDebugRun> => {
      readCount += 1;
      return debugRun(readCount === 1 ? {
        status: "running",
        rawEvents: '{"type":"thread.started","thread_id":"thread-1"}',
        reportMarkdown: ""
      } : {
        status: "completed",
        rawEvents: '{"type":"item.completed","item":{"type":"agent_message","text":"模型完成"}}',
        reportMarkdown: '[{"title":"中控技术高管调整"}]'
      });
    });
    const { elements, controller } = createFixture(
      categoryConfig([stockNode({ name: "中控技术", secid: "1.688777" })]),
      { getWatchNewsDebugRun }
    );

    emitContextAction(elements, "debug-news", "stock");

    await vi.waitFor(() => expect(elements.watchNewsDebugContent.innerHTML).toContain("运行中"));
    expect(elements.watchNewsDebugContent.innerHTML).toContain("thread.started");
    expect(intervalCallbacks).toHaveLength(1);

    intervalCallbacks[0]();
    await vi.waitFor(() => expect(getWatchNewsDebugRun).toHaveBeenCalledTimes(2));
    expect(elements.watchNewsDebugContent.innerHTML).toContain("已完成");
    expect(elements.watchNewsDebugContent.innerHTML).toContain("中控技术高管调整");

    elements.closeWatchNewsDebug.emit("click");
    expect(window.clearInterval).toHaveBeenCalledWith(1);
    controller.deactivate();
  });

  it("opens the stock news history after a single-stock analysis returns messages", async () => {
    const message = watchNewsMessage();
    const analyzeWatchStockNews = vi.fn(async (): Promise<WatchNewsAnalysisResult> => ({
      stockCount: 1,
      newMessageCount: 1,
      messages: [message],
      errors: []
    }));
    const listWatchNews = vi.fn(async () => [message]);
    const { elements } = createFixture(
      categoryConfig([stockNode({ name: "中控技术", secid: "1.688777" })]),
      { analyzeWatchStockNews, listWatchNews }
    );

    emitContextAction(elements, "refresh-news", "stock");

    await vi.waitFor(() => expect(elements.watchNewsHistoryPanel.hidden).toBe(false));
    expect(elements.watchNewsHistoryTitle.textContent).toContain("中控技术");
    expect(elements.watchNewsHistoryContent.innerHTML).toContain("治理和执行层稳定性");
  });

  it("keeps the news history closed when a single-stock analysis finds nothing", async () => {
    const { elements } = createFixture(
      categoryConfig([stockNode({ name: "中控技术", secid: "1.688777" })]),
      { listWatchNews: async () => [] }
    );

    emitContextAction(elements, "refresh-news", "stock");

    await vi.waitFor(() => expect(elements.watchStatus.textContent).toContain("新增 0 条消息"));
    expect(elements.watchNewsHistoryPanel.hidden).toBe(true);
  });
});

interface FixtureApiOverrides {
  analyzeWatchStockNews?: StockResearchApi["analyzeWatchStockNews"];
  getWatchNewsDebugRun?: StockResearchApi["getWatchNewsDebugRun"];
  listWatchNews?: StockResearchApi["listWatchNews"];
}

function createFixture(
  config: WatchTreeConfig,
  apiOverrides: FixtureApiOverrides = {}
): {
  elements: Record<string, TestElement>;
  saveWatchTree: ReturnType<typeof vi.fn<(config: WatchTreeConfig) => Promise<WatchTreeConfig>>>;
  controller: ReturnType<typeof createWatchController>;
} {
  const elements = createElements();
  const saveWatchTree = vi.fn(async (nextConfig: WatchTreeConfig) => nextConfig);
  const api = createApi(saveWatchTree, apiOverrides);
  const controller = createWatchController({
    api,
    elements: elements as unknown as RendererElements,
    isActive: () => false
  });
  controller.hydrate(config);
  controller.bindEvents();
  return { elements, saveWatchTree, controller };
}

function createElements(): Record<string, TestElement> {
  const elements = Object.fromEntries([
    "refreshWatchQuotes",
    "exportWatchData",
    "importWatchData",
    "watchStatus",
    "watchWorkspaceTabs",
    "addWatchWorkspace",
    "watchTradingDate",
    "watchMarketError",
    "refreshWatchNews",
    "showWatchNewsDebug",
    "watchPanel",
    "watchTree",
    "watchContextMenu",
    "watchNewsTooltip",
    "watchNewsHistoryPanel",
    "watchNewsHistoryHeader",
    "watchNewsHistoryTitle",
    "watchNewsHistoryContent",
    "closeWatchNewsHistory",
    "watchNewsDebugPanel",
    "watchNewsDebugTitle",
    "watchNewsDebugContent",
    "closeWatchNewsDebug",
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
  elements.watchNewsHistoryPanel.hidden = true;
  elements.watchNewsDebugPanel.hidden = true;
  return elements;
}

function createApi(
  saveWatchTree: (config: WatchTreeConfig) => Promise<WatchTreeConfig>,
  overrides: FixtureApiOverrides
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
    analyzeWatchStockNews: overrides.analyzeWatchStockNews ?? (async () => ({
      stockCount: 1,
      newMessageCount: 0,
      messages: [],
      errors: []
    })),
    analyzeHoldingWatchNews: async () => ({ stockCount: 0, newMessageCount: 0, messages: [], errors: [] }),
    getWatchNewsDebugRun: overrides.getWatchNewsDebugRun ?? (async () => undefined),
    listWatchNews: overrides.listWatchNews ?? (async () => []),
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

function emitContextAction(
  elements: Record<string, TestElement>,
  action: "refresh-news" | "debug-news",
  id: string
): void {
  const button = new TestElement();
  button.dataset.watchMenuAction = action;
  button.dataset.watchId = id;
  elements.watchContextMenu.emit("click", button);
}

function debugRun(overrides: Partial<WatchNewsDebugRun>): WatchNewsDebugRun {
  return {
    runId: "2026-07-12T11-48-21-100Z-1.688777",
    runDirectory: "C:/app/user_data/watch-news-runs/run",
    secid: "1.688777",
    stockName: "中控技术",
    createdAt: "2026-07-12T11:48:21.100Z",
    status: "running",
    prompt: "分析中控技术",
    events: [],
    rawEvents: "",
    stderr: "",
    reportMarkdown: "",
    ...overrides
  };
}

function watchNewsMessage(): WatchNewsMessage {
  return {
    id: "news-1",
    secid: "1.688777",
    stockName: "中控技术",
    title: "中控技术高管调整",
    summary: "公司调整并聘任部分高级管理人员。",
    sourceName: "东方财富公告",
    sourceUrl: "https://example.com/notice",
    occurredAt: "2026-07-10T18:06:17+08:00",
    fetchedAt: "2026-07-12T11:50:38.738Z",
    analysis: "中性，可能影响投资者对治理和执行层稳定性的预期。",
    confidence: "medium",
    dedupeKey: "1.688777|notice"
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
