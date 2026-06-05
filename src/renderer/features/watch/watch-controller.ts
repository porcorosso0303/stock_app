import type { StockResearchApi } from "../../../shared/ipc";
import type {
  StockQuote,
  StockSearchResult,
  StockTrend,
  WatchTreeConfig,
  WatchTreeNode
} from "../../../shared/types";
import {
  appendWatchTreeChild,
  collectStockSecids,
  findWatchTreeNode,
  removeWatchTreeNode,
  replaceWatchTreeNode,
  validateSecid
} from "../../../shared/watch-tree";
import type { RendererElements } from "../../app/dom";
import {
  closeWatchContextMenu,
  openEmptyWatchContextMenu,
  openWatchNodeContextMenu
} from "./watch-context-menu";
import { createWatchConnectors } from "./watch-connectors";
import { escapeHtml, renderWatchTree } from "./watch-view";

export interface WatchController {
  bindEvents(): void;
  hydrate(config: WatchTreeConfig): void;
  activate(): Promise<void>;
  deactivate(): void;
}

interface WatchControllerOptions {
  api: StockResearchApi;
  elements: RendererElements;
  isActive: () => boolean;
}

type WatchDialogAction =
  | { kind: "create-category" }
  | { kind: "add"; parentId: string; nodeType: WatchTreeNode["type"] }
  | { kind: "edit"; nodeId: string };

interface WatchPanState {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
  dragged: boolean;
}

export function createWatchController(options: WatchControllerOptions): WatchController {
  const { api, elements, isActive } = options;
  const connectors = createWatchConnectors(elements.watchTree);
  let config: WatchTreeConfig = {};
  let loaded = false;
  let quoteTimer: number | undefined;
  let quotes = new Map<string, StockQuote>();
  let trends = new Map<string, StockTrend>();
  let dialogAction: WatchDialogAction | undefined;
  let selectedStock: StockSearchResult | undefined;
  let pan: WatchPanState | undefined;
  let suppressNodeClick = false;
  const collapsedNodes = new Set<string>();

  function render(): void {
    renderWatchTree(elements.watchTree, {
      config,
      quotes,
      trends,
      collapsedNodes
    }, connectors.schedule);
  }

  async function loadTree(): Promise<void> {
    try {
      config = await api.getWatchTree();
      loaded = true;
      render();
    } catch (error) {
      elements.watchStatus.textContent = getErrorMessage(error);
    }
  }

  async function loadMarketData(): Promise<void> {
    await updateMarketData((secids) => api.getWatchMarketData(secids), "正在加载行情...");
  }

  async function refreshQuotes(): Promise<void> {
    await updateMarketData((secids) => api.refreshWatchMarketData(secids), "正在刷新行情...");
  }

  async function updateMarketData(
    load: (secids: string[]) => ReturnType<typeof api.getWatchMarketData>,
    loadingMessage: string
  ): Promise<void> {
    if (!isActive()) {
      return;
    }
    const secids = collectStockSecids(config.root);
    if (secids.length === 0) {
      quotes = new Map();
      trends = new Map();
      elements.watchStatus.textContent = "尚未配置股票叶子节点";
      render();
      return;
    }
    elements.watchStatus.textContent = loadingMessage;
    try {
      const marketData = await load(secids);
      quotes = new Map(marketData.quotes.map((quote) => [quote.secid, quote]));
      trends = new Map(marketData.trends.map((trend) => [trend.secid, trend]));
      const marketQuotes = marketData.quotes;
      const unavailable = marketQuotes.filter((quote) => quote.errorMessage).length;
      const timeText = marketData.updatedAt
        ? formatDate(marketData.updatedAt)
        : formatDate(marketQuotes[0].fetchedAt);
      const sourceText = marketData.fromCache ? "缓存行情时间" : "行情更新时间";
      elements.watchStatus.textContent = unavailable === 0
        ? `${sourceText}：${timeText}`
        : `${sourceText}：${timeText}，${unavailable} 只股票暂无行情`;
      render();
    } catch (error) {
      elements.watchStatus.textContent = getErrorMessage(error);
    }
  }

  function startPolling(): void {
    stopPolling();
    quoteTimer = window.setInterval(() => void refreshQuotes(), 15_000);
  }

  function stopPolling(): void {
    if (quoteTimer !== undefined) {
      window.clearInterval(quoteTimer);
    }
    quoteTimer = undefined;
  }

  function handleNodeClick(event: MouseEvent): void {
    if (suppressNodeClick) {
      suppressNodeClick = false;
      return;
    }
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".watch-node")
      : undefined;
    const node = findWatchTreeNode(config.root, element?.dataset.watchNodeId ?? "");
    if (node?.type === "category" && node.children.length > 0) {
      toggleCollapsedNode(node.id);
    }
  }

  function handleNodeContextMenu(event: MouseEvent): void {
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".watch-node")
      : undefined;
    const node = findWatchTreeNode(config.root, element?.dataset.watchNodeId ?? "");
    if (!node) {
      return;
    }
    event.preventDefault();
    openWatchNodeContextMenu(elements.watchContextMenu, node, event);
  }

  function handlePanelContextMenu(event: MouseEvent): void {
    if (config.root) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".watch-node")) {
      return;
    }
    event.preventDefault();
    openEmptyWatchContextMenu(elements.watchContextMenu, event);
  }

  function handleContextMenuClick(event: MouseEvent): void {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-watch-menu-action]")
      : undefined;
    if (!button) {
      return;
    }
    const id = button.dataset.watchId ?? "";
    switch (button.dataset.watchMenuAction) {
      case "create-category":
        openNodeDialog({ kind: "create-category" });
        break;
      case "add-category":
        openNodeDialog({ kind: "add", parentId: id, nodeType: "category" });
        break;
      case "add-stock":
        openNodeDialog({ kind: "add", parentId: id, nodeType: "stock" });
        break;
      case "edit":
        openNodeDialog({ kind: "edit", nodeId: id });
        break;
      case "delete":
        void deleteNode(id);
        break;
    }
    closeWatchContextMenu(elements.watchContextMenu);
  }

  function toggleCollapsedNode(id: string): void {
    if (collapsedNodes.has(id)) {
      collapsedNodes.delete(id);
    } else {
      collapsedNodes.add(id);
    }
    render();
  }

  function beginPan(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    closeWatchContextMenu(elements.watchContextMenu);
    pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: elements.watchPanel.scrollLeft,
      scrollTop: elements.watchPanel.scrollTop,
      dragged: false
    };
  }

  function movePan(event: PointerEvent): void {
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    const offsetX = event.clientX - pan.startX;
    const offsetY = event.clientY - pan.startY;
    if (!pan.dragged && Math.hypot(offsetX, offsetY) < 4) {
      return;
    }
    pan.dragged = true;
    elements.watchPanel.classList.add("dragging");
    elements.watchPanel.setPointerCapture(event.pointerId);
    elements.watchPanel.scrollLeft = pan.scrollLeft - offsetX;
    elements.watchPanel.scrollTop = pan.scrollTop - offsetY;
  }

  function endPan(event: PointerEvent): void {
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    suppressNodeClick = pan.dragged;
    pan = undefined;
    elements.watchPanel.classList.remove("dragging");
    if (elements.watchPanel.hasPointerCapture(event.pointerId)) {
      elements.watchPanel.releasePointerCapture(event.pointerId);
    }
    window.setTimeout(() => {
      suppressNodeClick = false;
    }, 0);
  }

  function openNodeDialog(action: WatchDialogAction): void {
    const existing = action.kind === "edit"
      ? findWatchTreeNode(config.root, action.nodeId)
      : undefined;
    dialogAction = action;
    elements.watchNodeDialogTitle.textContent = action.kind === "edit"
      ? "编辑节点"
      : action.kind === "create-category" ? "创建分类" : "添加节点";
    elements.watchNodeType.value = existing?.type
      ?? (action.kind === "add" ? action.nodeType : "category");
    elements.watchNodeType.disabled = action.kind !== "add";
    elements.watchNodeName.value = existing?.name ?? "";
    elements.watchNodeSecid.value = existing?.type === "stock" ? existing.secid : "";
    selectedStock = existing?.type === "stock"
      ? { secid: existing.secid, code: existing.secid.slice(2), name: existing.name }
      : undefined;
    elements.watchStockResults.hidden = true;
    elements.watchStockResults.innerHTML = "";
    elements.watchNodeError.textContent = "";
    syncSecidVisibility();
    elements.watchNodeDialog.showModal();
    elements.watchNodeName.focus();
  }

  function syncSecidVisibility(): void {
    const isStock = elements.watchNodeType.value === "stock";
    elements.searchWatchStock.hidden = !isStock;
    elements.watchStockResults.hidden = true;
    elements.watchNodeSecidLabel.hidden = !isStock;
    elements.watchNodeSecid.hidden = !isStock;
  }

  function handleNodeNameInput(): void {
    if (elements.watchNodeType.value !== "stock") {
      return;
    }
    if (selectedStock?.name !== elements.watchNodeName.value.trim()) {
      selectedStock = undefined;
      elements.watchNodeSecid.value = "";
    }
  }

  async function searchStocks(): Promise<void> {
    elements.watchNodeError.textContent = "";
    try {
      const results = await api.searchStocks(elements.watchNodeName.value);
      if (results.length === 0) {
        elements.watchStockResults.innerHTML = '<p class="muted">未找到 A 股候选</p>';
      } else {
        elements.watchStockResults.innerHTML = results.map((result) => `
          <button
            data-stock-secid="${escapeHtml(result.secid)}"
            data-stock-code="${escapeHtml(result.code)}"
            data-stock-name="${escapeHtml(result.name)}"
            data-stock-market="${escapeHtml(result.marketName ?? "")}"
            type="button"
          >
            <strong>${escapeHtml(result.name)}</strong>
            <span>${escapeHtml(result.code)} ${escapeHtml(result.marketName ?? "")}</span>
          </button>
        `).join("");
        elements.watchStockResults.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
          button.addEventListener("click", () => selectStock(button));
        });
      }
      elements.watchStockResults.hidden = false;
    } catch (error) {
      elements.watchNodeError.textContent = getErrorMessage(error);
    }
  }

  function selectStock(button: HTMLButtonElement): void {
    selectedStock = {
      secid: button.dataset.stockSecid ?? "",
      code: button.dataset.stockCode ?? "",
      name: button.dataset.stockName ?? "",
      marketName: button.dataset.stockMarket || undefined
    };
    elements.watchNodeName.value = selectedStock.name;
    elements.watchNodeSecid.value = selectedStock.secid;
    elements.watchStockResults.hidden = true;
  }

  async function saveNode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!dialogAction) {
      return;
    }
    const name = elements.watchNodeName.value.trim();
    if (!name) {
      elements.watchNodeError.textContent = "节点名称不能为空";
      return;
    }
    try {
      const type = elements.watchNodeType.value === "stock" ? "stock" : "category";
      const existing = dialogAction.kind === "edit"
        ? findWatchTreeNode(config.root, dialogAction.nodeId)
        : undefined;
      const node: WatchTreeNode = type === "stock"
        ? {
            id: existing?.id ?? crypto.randomUUID(),
            type,
            name,
            secid: validateSecid(elements.watchNodeSecid.value)
          }
        : {
            id: existing?.id ?? crypto.randomUUID(),
            type,
            name,
            children: existing?.type === "category" ? existing.children : []
          };
      if (dialogAction.kind === "create-category") {
        if (node.type !== "category") {
          throw new Error("请创建分类节点");
        }
        config = { root: node };
      } else if (dialogAction.kind === "add") {
        if (!config.root) {
          throw new Error("请先创建分类");
        }
        config = {
          root: appendWatchTreeChild(config.root, dialogAction.parentId, node)
        };
      } else {
        if (!config.root) {
          throw new Error("盯盘脑图尚未配置");
        }
        config = { root: replaceWatchTreeNode(config.root, node) };
      }
      await persistTree();
      elements.watchNodeDialog.close();
    } catch (error) {
      elements.watchNodeError.textContent = getErrorMessage(error);
    }
  }

  async function deleteNode(id: string): Promise<void> {
    if (!config.root || !confirm("确定删除该节点及其所有子节点吗？")) {
      return;
    }
    config = { root: removeWatchTreeNode(config.root, id) };
    collapsedNodes.delete(id);
    await persistTree();
  }

  async function persistTree(): Promise<void> {
    config = await api.saveWatchTree(config);
    render();
    await loadMarketData();
  }

  return {
    bindEvents: () => {
      elements.refreshWatchQuotes.addEventListener("click", () => void refreshQuotes());
      elements.watchNodeType.addEventListener("change", syncSecidVisibility);
      elements.watchNodeName.addEventListener("input", handleNodeNameInput);
      elements.searchWatchStock.addEventListener("click", () => void searchStocks());
      elements.watchNodeForm.addEventListener("submit", (event) => void saveNode(event));
      elements.cancelWatchNode.addEventListener("click", () => elements.watchNodeDialog.close());
      elements.watchTree.addEventListener("click", handleNodeClick);
      elements.watchTree.addEventListener("contextmenu", handleNodeContextMenu);
      elements.watchContextMenu.addEventListener("click", handleContextMenuClick);
      elements.watchPanel.addEventListener("contextmenu", handlePanelContextMenu);
      elements.watchPanel.addEventListener("pointerdown", beginPan);
      elements.watchPanel.addEventListener("pointermove", movePan);
      elements.watchPanel.addEventListener("pointerup", endPan);
      elements.watchPanel.addEventListener("pointercancel", endPan);
      elements.watchPanel.addEventListener("scroll", () => closeWatchContextMenu(elements.watchContextMenu));
      document.addEventListener("click", () => closeWatchContextMenu(elements.watchContextMenu));
      window.addEventListener("resize", connectors.schedule);
    },
    hydrate: (nextConfig) => {
      config = nextConfig;
      loaded = true;
      render();
    },
    activate: async () => {
      if (!loaded) {
        await loadTree();
      }
      startPolling();
      await loadMarketData();
    },
    deactivate: () => stopPolling()
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
