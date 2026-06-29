import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererElements } from "../../src/renderer/app/dom";
import { createWatchController } from "../../src/renderer/features/watch/watch-controller";
import type { StockResearchApi } from "../../src/shared/ipc";
import type {
  WatchMarketData,
  WatchTreeCategoryNode,
  WatchTreeConfig
} from "../../src/shared/types";

interface TestPointerEvent {
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
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
  remove = vi.fn(() => {
    this.dataset.removed = "true";
  });

  private readonly listeners = new Map<string, Array<(event: TestPointerEvent) => void>>();

  addEventListener(type: string, listener: (event: TestPointerEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emitPointer(
    type: string,
    target: TestElement,
    event: Partial<TestPointerEvent> = {}
  ): void {
    const pointerEvent: TestPointerEvent = {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      target,
      preventDefault: vi.fn(),
      ...event
    };
    this.listeners.get(type)?.forEach((listener) => listener(pointerEvent));
  }

  closest<T>(selector: string): T | null {
    if (selector === ".watch-node" && this.dataset.watchNodeId) {
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

  append(child: TestElement): void {
    this.children.push(child);
  }

  cloneNode(): TestElement {
    const clone = new TestElement();
    clone.dataset = { ...this.dataset };
    return clone;
  }

  setAttribute(name: string, value: string): void {
    this.dataset[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.dataset[name];
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

describe("watch node drag reparent", () => {
  beforeEach(() => {
    vi.stubGlobal("Element", TestElement);
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      elementFromPoint: vi.fn(),
      createElementNS: vi.fn()
    });
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

  it("saves a stock leaf under the drop target category when the sibling type rule allows it", async () => {
    const sourceStock = watchNodeElement("stock");
    const targetCategory = watchNodeElement("target");
    const { elements, saveWatchTree } = createFixture(stockMoveConfig());
    vi.mocked(document.elementFromPoint).mockReturnValue(targetCategory as unknown as Element);

    dragNode(elements.watchPanel, sourceStock, targetCategory);

    await vi.waitFor(() => expect(saveWatchTree).toHaveBeenCalledOnce());
    const savedRoot = saveWatchTree.mock.calls[0]?.[0].root;
    expect((savedRoot?.children[0] as WatchTreeCategoryNode).children).toEqual([]);
    expect((savedRoot?.children[1] as WatchTreeCategoryNode).children.map((child) => child.id))
      .toEqual(["stock"]);
  });

  it("creates a translucent drag ghost that follows the pointer while dragging a node", () => {
    const sourceStock = watchNodeElement("stock");
    const targetCategory = watchNodeElement("target");
    const { elements } = createFixture(stockMoveConfig());
    vi.mocked(document.elementFromPoint).mockReturnValue(targetCategory as unknown as Element);

    elements.watchPanel.emitPointer("pointerdown", sourceStock, { clientX: 10, clientY: 10 });
    elements.watchPanel.emitPointer("pointermove", sourceStock, { clientX: 28, clientY: 34 });

    const ghost = elements.watchPanel.children[0];
    expect(elements.watchPanel.classList.add).toHaveBeenCalledWith("node-dragging");
    expect(sourceStock.classList.add).toHaveBeenCalledWith("drag-source");
    expect(ghost.classList.add).toHaveBeenCalledWith("drag-ghost");
    expect(ghost.style.left).toBe("28px");
    expect(ghost.style.top).toBe("34px");

    elements.watchPanel.emitPointer("pointermove", sourceStock, { clientX: 48, clientY: 58 });
    expect(ghost.style.left).toBe("48px");
    expect(ghost.style.top).toBe("58px");

    elements.watchPanel.emitPointer("pointerup", targetCategory, { clientX: 48, clientY: 58 });
    expect(ghost.remove).toHaveBeenCalledOnce();
  });

  it("does not save when the dropped node would mix sibling node types", async () => {
    const sourceStock = watchNodeElement("stock");
    const targetCategory = watchNodeElement("target");
    const { elements, saveWatchTree } = createFixture(stockMoveConfig([{
      id: "nested-category",
      type: "category",
      name: "子分类",
      children: []
    }]));
    vi.mocked(document.elementFromPoint).mockReturnValue(targetCategory as unknown as Element);

    dragNode(elements.watchPanel, sourceStock, targetCategory);

    await Promise.resolve();
    expect(saveWatchTree).not.toHaveBeenCalled();
  });
});

function dragNode(
  panel: TestElement,
  source: TestElement,
  target: TestElement
): void {
  panel.emitPointer("pointerdown", source, { clientX: 10, clientY: 10 });
  panel.emitPointer("pointermove", source, { clientX: 18, clientY: 10 });
  panel.emitPointer("pointerup", target, { clientX: 18, clientY: 10 });
}

function watchNodeElement(id: string): TestElement {
  const element = new TestElement();
  element.dataset.watchNodeId = id;
  return element;
}

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
    setWatchMarketProvider: async (watchMarketProviderId) => ({ watchMarketProviderId }),
    onOpenWatchMarketProviderSettings: () => () => undefined,
    onWatchMarketProviderChanged: () => () => undefined,
    onResearchEvent: () => () => undefined
  };
}

function stockMoveConfig(targetChildren: WatchTreeCategoryNode["children"] = []): WatchTreeConfig {
  return {
    root: {
      id: "root",
      type: "category",
      name: "Root",
      children: [
        {
          id: "source",
          type: "category",
          name: "来源",
          children: [{ id: "stock", type: "stock", name: "股票", secid: "1.600001" }]
        },
        {
          id: "target",
          type: "category",
          name: "目标",
          children: targetChildren
        }
      ]
    }
  };
}
