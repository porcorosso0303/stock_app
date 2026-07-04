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
  appendWatchWorkspace,
  appendWatchTreeChild,
  collectStockSecids,
  deleteWatchWorkspace,
  ensureWatchWorkspaceConfig,
  findWatchTreeNode,
  getActiveWatchRoot,
  getActiveWatchWorkspace,
  moveWatchTreeNode,
  renameWatchWorkspace,
  removeWatchTreeNode,
  replaceWatchTreeNode,
  switchWatchWorkspace,
  updateActiveWatchRoot,
  validateSecid
} from "../../../shared/watch-tree";
import type { RendererElements } from "../../app/dom";
import {
  closeWatchContextMenu,
  openEmptyWatchContextMenu,
  openWatchNodeContextMenu,
  openWatchWorkspaceContextMenu
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
  let selectedTradingDate: string | undefined;
  let dateSelectionPinned = false;
  let suppressNodeClick = false;
  let renamingWorkspaceId: string | undefined;
  const collapsedNodes = new Set<string>();

  function render(): void {
    config = ensureWatchWorkspaceConfig(config);
    renderWorkspaceTabs();
    renderWatchTree(elements.watchTree, {
      config: { root: activeRoot() },
      quotes,
      trends,
      marketHistory,
      collapsedNodes
    }, connectors.schedule);
  }

  function activeRoot(): WatchTreeConfig["root"] {
    return getActiveWatchRoot(config);
  }

  function renderWorkspaceTabs(): void {
    const activeId = config.activeWorkspaceId;
    elements.watchWorkspaceTabs.innerHTML = (config.workspaces ?? []).map((workspace) => `
      <span class="watch-workspace-tab${workspace.id === activeId ? " active" : ""}" role="presentation">
        ${workspace.id === renamingWorkspaceId ? `
          <input
            class="watch-workspace-rename-input"
            data-watch-workspace-action="rename-input"
            data-watch-workspace-id="${escapeHtml(workspace.id)}"
            value="${escapeHtml(workspace.name)}"
            aria-label="重命名展示区"
          />
        ` : `
          <button
            class="watch-workspace-tab-switch"
            data-watch-workspace-action="switch"
            data-watch-workspace-id="${escapeHtml(workspace.id)}"
            type="button"
            role="tab"
            aria-selected="${workspace.id === activeId ? "true" : "false"}"
            title="双击或右键重命名：${escapeHtml(workspace.name)}"
          >${escapeHtml(workspace.name)}</button>
          <button
            class="watch-workspace-tab-close"
            data-watch-workspace-action="delete"
            data-watch-workspace-id="${escapeHtml(workspace.id)}"
            type="button"
            title="删除展示区"
            aria-label="删除 ${escapeHtml(workspace.name)}"
          >×</button>
        `}
      </span>
    `).join("");
  }

  async function loadTree(): Promise<void> {
    try {
      config = ensureWatchWorkspaceConfig(await api.getWatchTree());
      loaded = true;
      render();
    } catch (error) {
      elements.watchStatus.textContent = getErrorMessage(error);
    }
  }

  async function loadMarketData(): Promise<void> {
    await updateMarketData(
      (secids) => api.getWatchMarketData(secids, selectedTradingDate ? { tradingDate: selectedTradingDate } : undefined),
      "正在加载行情..."
    );
  }

  async function refreshQuotes(forceLatest = false): Promise<void> {
    if (dateSelectionPinned && selectedTradingDate) {
      await loadMarketData();
      return;
    }
    await updateMarketData(
      (secids) => api.refreshWatchMarketData(secids, forceLatest ? { forceLatest: true } : undefined),
      "正在刷新行情..."
    );
  }

  async function refreshLatestMarketData(): Promise<void> {
    if (dateSelectionPinned) {
      return;
    }
    await updateMarketData(
      (secids) => api.refreshWatchMarketData(secids, { forceLatest: true }),
      "正在校验最近交易日行情..."
    );
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
      config = ensureWatchWorkspaceConfig(await api.getWatchTree());
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
    const secids = collectStockSecids(activeRoot());
    if (secids.length === 0) {
      quotes = new Map();
      trends = new Map();
      marketHistory = [];
      elements.watchMarketError.textContent = "";
      elements.watchStatus.textContent = "尚未配置股票叶子节点";
      render();
      return;
    }
    marketUpdateInFlight = true;
    elements.watchMarketError.textContent = "";
    elements.watchStatus.textContent = loadingMessage;
    try {
      const marketData = await load(secids);
      quotes = new Map(marketData.quotes.map((quote) => [quote.secid, quote]));
      trends = new Map(marketData.trends.map((trend) => [trend.secid, trend]));
      marketHistory = marketData.history ?? currentMarketDataAsHistory(marketData);
      if (marketData.tradingDate && !dateSelectionPinned) {
        selectedTradingDate = marketData.tradingDate;
      }
      syncTradingDateOptions(marketData);
      const marketQuotes = marketData.quotes;
      elements.watchMarketError.textContent = summarizeMarketErrors(marketQuotes);
      elements.watchStatus.textContent = "";
      render();
    } catch (error) {
      elements.watchMarketError.textContent = getErrorMessage(error);
      elements.watchStatus.textContent = "";
    } finally {
      marketUpdateInFlight = false;
    }
  }

  function startPolling(): void {
    stopPolling();
    quoteTimer = window.setInterval(() => void refreshQuotes(), 10_000);
  }

  async function handleTradingDateChange(): Promise<void> {
    selectedTradingDate = elements.watchTradingDate.value || undefined;
    dateSelectionPinned = true;
    await updateMarketData(
      (secids) => api.getWatchMarketData(secids, selectedTradingDate ? { tradingDate: selectedTradingDate } : undefined),
      "正在加载所选日期行情..."
    );
  }

  function syncTradingDateOptions(marketData: Awaited<ReturnType<StockResearchApi["getWatchMarketData"]>>): void {
    const dates = new Set<string>([
      ...recentWeekdayDates(30),
      ...(marketData.history ?? []).map((day) => day.tradingDate),
      ...(marketData.tradingDate ? [marketData.tradingDate] : [])
    ]);
    const nextValue = selectedTradingDate ?? marketData.tradingDate ?? "";
    elements.watchTradingDate.innerHTML = [...dates]
      .sort((left, right) => right.localeCompare(left))
      .map((date) => `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`)
      .join("");
    elements.watchTradingDate.value = nextValue;
  }

  function stopPolling(): void {
    if (quoteTimer !== undefined) {
      window.clearInterval(quoteTimer);
    }
    quoteTimer = undefined;
  }

  async function createWorkspace(): Promise<void> {
    try {
      config = appendWatchWorkspace(config, {
        id: crypto.randomUUID(),
        name: nextWorkspaceName()
      });
      collapsedNodes.clear();
      await persistTree(false);
    } catch (error) {
      elements.watchMarketError.textContent = getErrorMessage(error);
    }
  }

  function nextWorkspaceName(): string {
    const names = new Set((config.workspaces ?? []).map((workspace) => workspace.name));
    for (let index = (config.workspaces?.length ?? 0) + 1; ; index += 1) {
      const name = `展示区 ${index}`;
      if (!names.has(name)) {
        return name;
      }
    }
  }

  async function switchWorkspace(workspaceId: string): Promise<void> {
    if (!workspaceId || workspaceId === config.activeWorkspaceId) {
      return;
    }
    config = switchWatchWorkspace(config, workspaceId);
    collapsedNodes.clear();
    await persistTree(false);
  }

  function beginRenameWorkspace(workspaceId: string): void {
    const workspace = config.workspaces?.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }
    closeWatchContextMenu(elements.watchContextMenu);
    renamingWorkspaceId = workspaceId;
    renderWorkspaceTabs();
    focusRenameWorkspaceInput();
  }

  function focusRenameWorkspaceInput(): void {
    window.setTimeout(() => {
      const input = elements.watchWorkspaceTabs.querySelector<HTMLInputElement>(".watch-workspace-rename-input");
      input?.focus();
      input?.select();
    }, 0);
  }

  async function finishRenameWorkspace(workspaceId: string, rawName: string): Promise<void> {
    const workspace = config.workspaces?.find((item) => item.id === workspaceId);
    const name = rawName.trim();
    renamingWorkspaceId = undefined;
    if (!workspace || !name || name === workspace.name) {
      renderWorkspaceTabs();
      return;
    }
    try {
      config = renameWatchWorkspace(config, workspaceId, name);
      await persistTree(false);
    } catch (error) {
      elements.watchMarketError.textContent = getErrorMessage(error);
      renderWorkspaceTabs();
    }
  }

  async function removeWorkspace(workspaceId: string): Promise<void> {
    const workspace = config.workspaces?.find((item) => item.id === workspaceId);
    if (!workspace || !confirm(`确定删除展示区「${workspace.name}」吗？`)) {
      return;
    }
    config = deleteWatchWorkspace(config, workspaceId);
    collapsedNodes.clear();
    await persistTree(false);
  }

  async function switchWorkspaceByOffset(offset: number): Promise<void> {
    const workspaces = config.workspaces ?? [];
    if (workspaces.length < 2) {
      return;
    }
    const currentIndex = Math.max(0, workspaces.findIndex((workspace) => workspace.id === config.activeWorkspaceId));
    const nextIndex = (currentIndex + offset + workspaces.length) % workspaces.length;
    await switchWorkspace(workspaces[nextIndex].id);
  }

  function handleWorkspaceTabsClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest('input[data-watch-workspace-action="rename-input"]')) {
      return;
    }
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-watch-workspace-action]")
      : undefined;
    if (!button) {
      return;
    }
    const workspaceId = button.dataset.watchWorkspaceId ?? "";
    if (button.dataset.watchWorkspaceAction === "switch") {
      void switchWorkspace(workspaceId);
    } else if (button.dataset.watchWorkspaceAction === "delete") {
      void removeWorkspace(workspaceId);
    }
  }

  function handleWorkspaceTabsDoubleClick(event: MouseEvent): void {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-watch-workspace-action="switch"]')
      : undefined;
    if (!button) {
      return;
    }
    event.preventDefault();
    beginRenameWorkspace(button.dataset.watchWorkspaceId ?? "");
  }

  function handleWorkspaceTabsContextMenu(event: MouseEvent): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-watch-workspace-id]")
      : undefined;
    const workspaceId = target?.dataset.watchWorkspaceId ?? "";
    if (!workspaceId) {
      return;
    }
    event.preventDefault();
    openWatchWorkspaceContextMenu(elements.watchContextMenu, workspaceId, event);
  }

  function handleWorkspaceTabsKeyDown(event: KeyboardEvent): void {
    const input = event.target instanceof Element
      ? event.target.closest<HTMLInputElement>('input[data-watch-workspace-action="rename-input"]')
      : undefined;
    if (!input) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void finishRenameWorkspace(input.dataset.watchWorkspaceId ?? "", input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      renamingWorkspaceId = undefined;
      renderWorkspaceTabs();
    }
  }

  function handleWorkspaceTabsFocusOut(event: FocusEvent): void {
    const input = event.target instanceof Element
      ? event.target.closest<HTMLInputElement>('input[data-watch-workspace-action="rename-input"]')
      : undefined;
    if (!input) {
      return;
    }
    void finishRenameWorkspace(input.dataset.watchWorkspaceId ?? "", input.value);
  }

  function handleWorkspaceShortcut(event: KeyboardEvent): void {
    if (!isActive() || !event.ctrlKey || event.altKey || event.metaKey || isEditableTarget(event.target)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key !== "a" && key !== "d") {
      return;
    }
    event.preventDefault();
    void switchWorkspaceByOffset(key === "a" ? -1 : 1);
  }

  function handleNodeClick(event: MouseEvent): void {
    if (suppressNodeClick) {
      suppressNodeClick = false;
      return;
    }
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".watch-node")
      : undefined;
    const node = findWatchTreeNode(activeRoot(), element?.dataset.watchNodeId ?? "");
    if (node?.type === "category" && node.children.length > 0) {
      toggleCollapsedNode(node.id);
    }
  }

  function handleNodeContextMenu(event: MouseEvent): void {
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".watch-node")
      : undefined;
    const node = findWatchTreeNode(activeRoot(), element?.dataset.watchNodeId ?? "");
    if (!node) {
      return;
    }
    event.preventDefault();
    openWatchNodeContextMenu(elements.watchContextMenu, node, event);
  }

  function handlePanelContextMenu(event: MouseEvent): void {
    if (activeRoot()) {
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
      case "rename-workspace":
        beginRenameWorkspace(id);
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
    if (!nodeId || !findWatchTreeNode(activeRoot(), nodeId) || !element) {
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
    const root = activeRoot();
    if (drag.dragged && shouldDrop && root) {
      const target = findDropTarget(event.clientX, event.clientY);
      const targetId = target?.dataset.watchNodeId ?? "";
      const nextRoot = targetId
        ? moveWatchTreeNode(root, drag.nodeId, targetId)
        : root;
      if (nextRoot !== root) {
        config = updateActiveWatchRoot(config, nextRoot);
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
      ? findWatchTreeNode(activeRoot(), action.nodeId)
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
        ? findWatchTreeNode(activeRoot(), dialogAction.nodeId)
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
        config = updateActiveWatchRoot(config, node);
      } else if (dialogAction.kind === "add") {
        const root = activeRoot();
        if (!root) {
          throw new Error("请先创建分类");
        }
        config = updateActiveWatchRoot(config, appendWatchTreeChild(root, dialogAction.parentId, node));
      } else {
        const root = activeRoot();
        if (!root) {
          throw new Error("盯盘脑图尚未配置");
        }
        config = updateActiveWatchRoot(config, replaceWatchTreeNode(root, node));
      }
      await persistTree();
      elements.watchNodeDialog.close();
    } catch (error) {
      elements.watchNodeError.textContent = getErrorMessage(error);
    }
  }

  async function deleteNode(id: string): Promise<void> {
    const root = activeRoot();
    if (!root || !confirm("确定删除该节点及其所有子节点吗？")) {
      return;
    }
    config = updateActiveWatchRoot(config, removeWatchTreeNode(root, id));
    collapsedNodes.delete(id);
    await persistTree();
  }

  async function persistTree(reloadMarketData = true): Promise<void> {
    config = ensureWatchWorkspaceConfig(await api.saveWatchTree(ensureWatchWorkspaceConfig(config)));
    render();
    if (reloadMarketData) {
      await loadMarketData();
    }
  }

  return {
    bindEvents: () => {
      elements.refreshWatchQuotes.addEventListener("click", () => void refreshQuotes(true));
      elements.exportWatchData.addEventListener("click", () => void exportData());
      elements.importWatchData.addEventListener("click", () => void importData());
      elements.addWatchWorkspace.addEventListener("click", () => void createWorkspace());
      elements.watchWorkspaceTabs.addEventListener("click", handleWorkspaceTabsClick);
      elements.watchWorkspaceTabs.addEventListener("dblclick", handleWorkspaceTabsDoubleClick);
      elements.watchWorkspaceTabs.addEventListener("contextmenu", handleWorkspaceTabsContextMenu);
      elements.watchWorkspaceTabs.addEventListener("keydown", handleWorkspaceTabsKeyDown);
      elements.watchWorkspaceTabs.addEventListener("focusout", handleWorkspaceTabsFocusOut);
      elements.watchTradingDate.addEventListener("change", () => void handleTradingDateChange());
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
      document.addEventListener("keydown", handleWorkspaceShortcut);
      window.addEventListener("resize", connectors.schedule);
      api.onWatchMarketProviderChanged(() => {
        if (isActive()) {
          void loadMarketData();
        }
      });
    },
    hydrate: (nextConfig) => {
      config = ensureWatchWorkspaceConfig(nextConfig);
      loaded = true;
      render();
    },
    activate: async () => {
      if (!loaded) {
        await loadTree();
      }
      startPolling();
      await loadMarketData();
      void refreshLatestMarketData();
    },
    deactivate: () => stopPolling()
  };
}

function readIndustryPosition(value: string): WatchIndustryPosition | undefined {
  return value === "leader1" || value === "leader2" || value === "leader3"
    ? value
    : undefined;
}

function recentWeekdayDates(days: number, now = new Date()): string[] {
  return Array.from({ length: days }, (_value, index) => {
    const date = new Date(now.getTime() - index * 24 * 60 * 60 * 1000);
    return formatChinaDate(date);
  }).filter((date) => {
    const day = new Date(`${date}T00:00:00+08:00`).getDay();
    return day >= 1 && day <= 5;
  });
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

export function summarizeMarketErrors(marketQuotes: StockQuote[]): string {
  const errors = marketQuotes
    .map((quote) => quote.errorMessage?.trim())
    .filter((error): error is string => !!error);
  if (errors.length === 0) {
    return "";
  }
  const uniqueErrors = [...new Set(errors)];
  const baseMessage = `${errors.length} 只股票暂无行情`;
  return uniqueErrors.length === 1
    ? `${baseMessage}：${uniqueErrors[0]}`
    : baseMessage;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']");
}

function formatChinaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
