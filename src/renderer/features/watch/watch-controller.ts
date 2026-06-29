import type { StockResearchApi } from "../../../shared/ipc";
import type {
  StockQuote,
  StockSearchResult,
  StockTrend,
  WatchIndustryPosition,
  WatchMarketCache,
  WatchTreeConfig,
  WatchTreeNode
} from "../../../shared/types";
import {
  appendWatchTreeChild,
  collectStockSecids,
  findWatchTreeNode,
  moveWatchTreeNode,
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

interface WatchNodeDragState {
  pointerId: number;
  nodeId: string;
  startX: number;
  startY: number;
  dragged: boolean;
  sourceElement: HTMLElement;
  targetElement?: HTMLElement;
  ghostElement?: HTMLElement;
}

export function createWatchController(options: WatchControllerOptions): WatchController {
  const { api, elements, isActive } = options;
  const connectors = createWatchConnectors(elements.watchTree);
  let config: WatchTreeConfig = {};
  let loaded = false;
  let quoteTimer: number | undefined;
  let marketUpdateInFlight = false;
  let quotes = new Map<string, StockQuote>();
  let trends = new Map<string, StockTrend>();
  let marketHistory: WatchMarketCache[] = [];
  let dialogAction: WatchDialogAction | undefined;
  let selectedStock: StockSearchResult | undefined;
  let pan: WatchPanState | undefined;
  let nodeDrag: WatchNodeDragState | undefined;
  let suppressNodeClick = false;
  const collapsedNodes = new Set<string>();

  function render(): void {
    renderWatchTree(elements.watchTree, {
      config,
      quotes,
      trends,
      marketHistory,
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

  async function exportData(): Promise<void> {
    try {
      const result = await api.exportWatchData();
      if (!result) {
        return;
      }
      elements.watchStatus.textContent = `已导出 ${result.stockCount} 只股票、${result.tradingDates.length} 个交易日数据`;
    } catch (error) {
      elements.watchStatus.textContent = getErrorMessage(error);
    }
  }

  async function importData(): Promise<void> {
    if (!confirm("导入会覆盖当前盯盘脑图和本地行情缓存，确定继续吗？")) {
      return;
    }
    try {
      const result = await api.importWatchData();
      if (!result) {
        return;
      }
      config = await api.getWatchTree();
      loaded = true;
      render();
      await loadMarketData();
      elements.watchStatus.textContent = `已导入 ${result.stockCount} 只股票、${result.tradingDates.length} 个交易日数据`;
    } catch (error) {
      elements.watchStatus.textContent = getErrorMessage(error);
    }
  }

  async function updateMarketData(
    load: (secids: string[]) => ReturnType<typeof api.getWatchMarketData>,
    loadingMessage: string
  ): Promise<void> {
    if (!isActive()) {
      return;
    }
    if (marketUpdateInFlight) {
      return;
    }
    const secids = collectStockSecids(config.root);
    if (secids.length === 0) {
      quotes = new Map();
      trends = new Map();
      marketHistory = [];
      elements.watchStatus.textContent = "尚未配置股票叶子节点";
      render();
      return;
    }
    marketUpdateInFlight = true;
    elements.watchStatus.textContent = loadingMessage;
    try {
      const marketData = await load(secids);
      quotes = new Map(marketData.quotes.map((quote) => [quote.secid, quote]));
      trends = new Map(marketData.trends.map((trend) => [trend.secid, trend]));
      marketHistory = marketData.history ?? currentMarketDataAsHistory(marketData);
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
    } finally {
      marketUpdateInFlight = false;
    }
  }

  function startPolling(): void {
    stopPolling();
    quoteTimer = window.setInterval(() => void refreshQuotes(), 10_000);
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

  function handlePointerDown(event: PointerEvent): void {
    if (beginNodeDrag(event)) {
      return;
    }
    beginPan(event);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (moveNodeDrag(event)) {
      return;
    }
    movePan(event);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (nodeDrag) {
      void endNodeDrag(event, true);
      return;
    }
    endPan(event);
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (nodeDrag) {
      void endNodeDrag(event, false);
      return;
    }
    endPan(event);
  }

  function beginNodeDrag(event: PointerEvent): boolean {
    if (event.button !== 0) {
      return false;
    }
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".watch-node")
      : undefined;
    const nodeId = element?.dataset.watchNodeId ?? "";
    if (!nodeId || !findWatchTreeNode(config.root, nodeId) || !element) {
      return false;
    }
    closeWatchContextMenu(elements.watchContextMenu);
    nodeDrag = {
      pointerId: event.pointerId,
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
      sourceElement: element
    };
    return true;
  }

  function moveNodeDrag(event: PointerEvent): boolean {
    if (!nodeDrag || nodeDrag.pointerId !== event.pointerId) {
      return false;
    }
    const offsetX = event.clientX - nodeDrag.startX;
    const offsetY = event.clientY - nodeDrag.startY;
    if (!nodeDrag.dragged && Math.hypot(offsetX, offsetY) < 4) {
      return true;
    }
    nodeDrag.dragged = true;
    event.preventDefault();
    elements.watchPanel.classList.add("node-dragging");
    nodeDrag.sourceElement.classList.add("drag-source");
    positionNodeDragGhost(ensureNodeDragGhost(nodeDrag), event.clientX, event.clientY);
    elements.watchPanel.setPointerCapture(event.pointerId);
    syncNodeDragTarget(event.clientX, event.clientY);
    return true;
  }

  async function endNodeDrag(event: PointerEvent, shouldDrop: boolean): Promise<void> {
    if (!nodeDrag || nodeDrag.pointerId !== event.pointerId) {
      return;
    }
    const drag = nodeDrag;
    if (drag.dragged) {
      suppressNodeClick = true;
    }
    nodeDrag = undefined;
    clearNodeDragClasses(drag);
    if (elements.watchPanel.hasPointerCapture(event.pointerId)) {
      elements.watchPanel.releasePointerCapture(event.pointerId);
    }
    if (drag.dragged && shouldDrop && config.root) {
      const target = findDropTarget(event.clientX, event.clientY);
      const targetId = target?.dataset.watchNodeId ?? "";
      const nextRoot = targetId
        ? moveWatchTreeNode(config.root, drag.nodeId, targetId)
        : config.root;
      if (nextRoot !== config.root) {
        config = { root: nextRoot };
        await persistTree();
      }
    }
    window.setTimeout(() => {
      suppressNodeClick = false;
    }, 0);
  }

  function syncNodeDragTarget(clientX: number, clientY: number): void {
    if (!nodeDrag) {
      return;
    }
    const target = findDropTarget(clientX, clientY);
    if (nodeDrag.targetElement === target) {
      return;
    }
    nodeDrag.targetElement?.classList.remove("drag-target");
    nodeDrag.targetElement = target;
    nodeDrag.targetElement?.classList.add("drag-target");
  }

  function findDropTarget(clientX: number, clientY: number): HTMLElement | undefined {
    const element = document.elementFromPoint(clientX, clientY);
    return element instanceof Element
      ? element.closest<HTMLElement>(".watch-node") ?? undefined
      : undefined;
  }

  function clearNodeDragClasses(drag: WatchNodeDragState): void {
    elements.watchPanel.classList.remove("node-dragging");
    drag.sourceElement.classList.remove("drag-source");
    drag.targetElement?.classList.remove("drag-target");
    drag.ghostElement?.remove();
  }

  function ensureNodeDragGhost(drag: WatchNodeDragState): HTMLElement {
    if (drag.ghostElement) {
      return drag.ghostElement;
    }
    const ghost = drag.sourceElement.cloneNode(true) as HTMLElement;
    ghost.classList.add("drag-ghost");
    ghost.removeAttribute("data-watch-node-id");
    ghost.removeAttribute("data-watch-parent-id");
    ghost.setAttribute("aria-hidden", "true");
    elements.watchPanel.append(ghost);
    drag.ghostElement = ghost;
    return ghost;
  }

  function positionNodeDragGhost(ghost: HTMLElement, clientX: number, clientY: number): void {
    ghost.style.left = `${clientX}px`;
    ghost.style.top = `${clientY}px`;
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
    elements.watchNodeIndustryPosition.value = existing?.type === "stock" ? existing.industryPosition ?? "" : "";
    elements.watchNodeHolding.value = existing?.type === "stock" && existing.isHolding ? "true" : "false";
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
    elements.watchNodeIndustryPositionLabel.hidden = !isStock;
    elements.watchNodeIndustryPosition.hidden = !isStock;
    elements.watchNodeHoldingLabel.hidden = !isStock;
    elements.watchNodeHolding.hidden = !isStock;
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
            secid: validateSecid(elements.watchNodeSecid.value),
            industryPosition: readIndustryPosition(elements.watchNodeIndustryPosition.value),
            ...(elements.watchNodeHolding.value === "true" ? { isHolding: true } : {})
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
      elements.exportWatchData.addEventListener("click", () => void exportData());
      elements.importWatchData.addEventListener("click", () => void importData());
      elements.watchNodeType.addEventListener("change", syncSecidVisibility);
      elements.watchNodeName.addEventListener("input", handleNodeNameInput);
      elements.searchWatchStock.addEventListener("click", () => void searchStocks());
      elements.watchNodeForm.addEventListener("submit", (event) => void saveNode(event));
      elements.cancelWatchNode.addEventListener("click", () => elements.watchNodeDialog.close());
      elements.watchTree.addEventListener("click", handleNodeClick);
      elements.watchTree.addEventListener("contextmenu", handleNodeContextMenu);
      elements.watchContextMenu.addEventListener("click", handleContextMenuClick);
      elements.watchPanel.addEventListener("contextmenu", handlePanelContextMenu);
      elements.watchPanel.addEventListener("pointerdown", handlePointerDown);
      elements.watchPanel.addEventListener("pointermove", handlePointerMove);
      elements.watchPanel.addEventListener("pointerup", handlePointerUp);
      elements.watchPanel.addEventListener("pointercancel", handlePointerCancel);
      elements.watchPanel.addEventListener("scroll", () => closeWatchContextMenu(elements.watchContextMenu));
      document.addEventListener("click", () => closeWatchContextMenu(elements.watchContextMenu));
      window.addEventListener("resize", connectors.schedule);
      api.onWatchMarketProviderChanged(() => {
        if (isActive()) {
          void loadMarketData();
        }
      });
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

function readIndustryPosition(value: string): WatchIndustryPosition | undefined {
  return value === "leader1" || value === "leader2" || value === "leader3"
    ? value
    : undefined;
}

function currentMarketDataAsHistory(
  marketData: Awaited<ReturnType<StockResearchApi["getWatchMarketData"]>>
): WatchMarketCache[] {
  if (!marketData.tradingDate) {
    return [];
  }
  return [{
    tradingDate: marketData.tradingDate,
    updatedAt: marketData.updatedAt,
    quotes: marketData.quotes,
    trends: marketData.trends
  }];
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
