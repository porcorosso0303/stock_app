import "./styles.css";
import type {
  StockQuote,
  StockSearchResult,
  StockTrend,
  WatchTreeConfig,
  WatchTreeNode
} from "../shared/types";
import {
  appendWatchTreeChild,
  averageChangePercent,
  collectStockSecids,
  findWatchTreeNode,
  formatTrendPercentClass,
  removeWatchTreeNode,
  replaceWatchTreeNode,
  renderTrendSparklineSvg,
  validateSecid
} from "../shared/watch-tree";
import { initializationErrorMessage } from "./view-model";
import { elements } from "./app/dom";
import {
  createShellController,
  type FeatureName
} from "./app/shell-controller";
import { createResearchController } from "./features/research/research-controller";

const api = window.stockResearch;
let activeFeature: FeatureName = "research";
let watchConfig: WatchTreeConfig = {};
let watchTreeLoaded = false;
let watchQuoteTimer: number | undefined;
let watchQuotes = new Map<string, StockQuote>();
let watchTrends = new Map<string, StockTrend>();
let watchDialogAction: WatchDialogAction | undefined;
let watchConnectorFrame: number | undefined;
let selectedWatchStock: StockSearchResult | undefined;
let watchPan: WatchPanState | undefined;
let suppressWatchNodeClick = false;
const collapsedWatchNodes = new Set<string>();
const watchConnectorColors = ["#5278c7", "#6f55bb", "#4e9858", "#bf7654"];
const shellController = createShellController({
  elements,
  onFeatureChanged: (feature) => {
    activeFeature = feature;
  },
  onActivateWatch: async () => {
    if (!watchTreeLoaded) {
      await loadWatchTree();
    }
    startWatchQuotePolling();
    await loadWatchMarketData();
  },
  onDeactivateWatch: () => stopWatchQuotePolling()
});
const researchController = createResearchController({
  api,
  elements,
  selectTab: shellController.selectTab
});

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

void initialize().catch((error: unknown) => {
  const message = initializationErrorMessage(error);
  elements.codexStatus.textContent = message;
  elements.taskStatus.textContent = message;
});

async function initialize(): Promise<void> {
  bindWatchEvents();
  shellController.bindEvents();
  researchController.bindEvents();
  const state = await api.getBootstrap();
  watchConfig = state.watchTree;
  watchTreeLoaded = true;
  researchController.initialize(state, await api.getResearchSpec());
  api.onResearchEvent(researchController.handleProgress);
}

function bindWatchEvents(): void {
  elements.refreshWatchQuotes.addEventListener("click", () => void refreshWatchQuotes());
  elements.watchNodeType.addEventListener("change", syncWatchNodeSecidVisibility);
  elements.watchNodeName.addEventListener("input", handleWatchNodeNameInput);
  elements.searchWatchStock.addEventListener("click", () => void searchWatchStocks());
  elements.watchNodeForm.addEventListener("submit", (event) => void saveWatchNode(event));
  elements.cancelWatchNode.addEventListener("click", () => elements.watchNodeDialog.close());
  elements.watchTree.addEventListener("click", handleWatchNodeClick);
  elements.watchTree.addEventListener("contextmenu", handleWatchNodeContextMenu);
  elements.watchContextMenu.addEventListener("click", handleWatchContextMenuClick);
  elements.watchPanel.addEventListener("contextmenu", handleWatchPanelContextMenu);
  elements.watchPanel.addEventListener("pointerdown", beginWatchPan);
  elements.watchPanel.addEventListener("pointermove", moveWatchPan);
  elements.watchPanel.addEventListener("pointerup", endWatchPan);
  elements.watchPanel.addEventListener("pointercancel", endWatchPan);
  elements.watchPanel.addEventListener("scroll", closeWatchContextMenu);
  document.addEventListener("click", closeWatchContextMenu);
  window.addEventListener("resize", scheduleWatchConnectors);
}

async function loadWatchTree(): Promise<void> {
  try {
    watchConfig = await api.getWatchTree();
    watchTreeLoaded = true;
    renderWatchTree();
  } catch (error) {
    elements.watchStatus.textContent = getErrorMessage(error);
  }
}

function renderWatchTree(): void {
  if (!watchConfig.root) {
    elements.watchTree.innerHTML = `
      <div class="watch-empty">
        <p>在空白区域点击鼠标右键创建分类。</p>
      </div>
    `;
    return;
  }
  elements.watchTree.innerHTML = `
    <div class="watch-graph">
      <svg class="watch-connectors" aria-hidden="true"></svg>
      <ul class="watch-root">
        <li class="watch-branch">${renderWatchNode(watchConfig.root, undefined, 0)}</li>
      </ul>
    </div>
  `;
  scheduleWatchConnectors();
}

function renderWatchNode(
  node: WatchTreeNode,
  parentId: string | undefined,
  depth: number
): string {
  const isCollapsed = collapsedWatchNodes.has(node.id);
  const children = node.type === "category" && !isCollapsed
    ? `<ul class="watch-children">${node.children.map((child) => `
        <li class="watch-branch">${renderWatchNode(child, node.id, depth + 1)}</li>
      `).join("")}</ul>`
    : "";
  const collapsedMarker = node.type === "category" && node.children.length > 0 && isCollapsed
    ? '<span class="watch-collapsed-marker" aria-hidden="true">+</span>'
    : "";
  return `
    <div class="watch-node-wrap">
      <div
        class="watch-node ${node.type}"
        data-watch-node-id="${escapeHtml(node.id)}"
        data-watch-parent-id="${escapeHtml(parentId ?? "")}"
        data-watch-depth="${depth}"
        title="${escapeHtml(renderWatchNodeTooltip(node, isCollapsed))}"
      >
        ${renderWatchNodeContent(node)}
      </div>
      ${collapsedMarker}
    </div>
    ${children}
  `;
}

function renderWatchNodeContent(node: WatchTreeNode): string {
  if (node.type === "category") {
    return `<strong>${escapeHtml(node.name)}</strong>`;
  }
  const quote = watchQuotes.get(node.secid);
  const trend = watchTrends.get(node.secid);
  return `
    <strong>${escapeHtml(node.name)}</strong>
    <span class="watch-trend-inline">
      ${renderTrendSparklineSvg(trend?.points ?? [], quote?.changePercent)}
      <span class="${formatTrendPercentClass(quote?.changePercent)}">${escapeHtml(formatChangePercent(quote?.changePercent))}</span>
    </span>
  `;
}

function scheduleWatchConnectors(): void {
  if (watchConnectorFrame !== undefined) {
    window.cancelAnimationFrame(watchConnectorFrame);
  }
  watchConnectorFrame = window.requestAnimationFrame(() => {
    watchConnectorFrame = undefined;
    drawWatchConnectors();
  });
}

function drawWatchConnectors(): void {
  const graph = elements.watchTree.querySelector<HTMLElement>(".watch-graph");
  const svg = elements.watchTree.querySelector<SVGSVGElement>(".watch-connectors");
  if (!graph || !svg) {
    return;
  }

  const graphRect = graph.getBoundingClientRect();
  const width = graph.scrollWidth;
  const height = graph.scrollHeight;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const nodes = [...graph.querySelectorAll<HTMLElement>(".watch-node[data-watch-node-id]")];
  const nodesById = new Map(nodes.map((node) => [node.dataset.watchNodeId ?? "", node]));
  for (const child of nodes) {
    const parentId = child.dataset.watchParentId;
    const parent = parentId ? nodesById.get(parentId) : undefined;
    if (!parent) {
      continue;
    }
    const parentRect = parent.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    const fromX = parentRect.right - graphRect.left;
    const fromY = parentRect.top - graphRect.top + parentRect.height / 2;
    const toX = childRect.left - graphRect.left;
    const toY = childRect.top - graphRect.top + childRect.height / 2;
    const controlOffset = Math.max(36, (toX - fromX) * 0.55);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`
    );
    path.setAttribute(
      "stroke",
      watchConnectorColors[Number(child.dataset.watchDepth ?? 1) % watchConnectorColors.length]
    );
    path.setAttribute("class", "watch-connector");
    svg.append(path);
  }
}

function renderWatchNodeTooltip(node: WatchTreeNode, isCollapsed: boolean): string {
  if (node.type === "stock") {
    const quote = watchQuotes.get(node.secid);
    const price = quote?.price === undefined ? "暂无行情" : `¥${quote.price.toFixed(2)}`;
    return `${node.name}\n${node.secid}\n价格：${price}\n涨跌幅：${formatChangePercent(quote?.changePercent)}\n右键编辑或删除`;
  }
  const leafCount = collectStockSecids(node).length;
  const average = averageChangePercent(node, watchQuotes);
  const action = node.children.length > 0
    ? `左键${isCollapsed ? "展开" : "回缩"}，右键配置`
    : "右键添加子节点";
  return `${node.name}\n${leafCount} 只股票\n平均涨跌幅：${formatChangePercent(average)}\n${action}`;
}

function handleWatchNodeClick(event: MouseEvent): void {
  if (suppressWatchNodeClick) {
    suppressWatchNodeClick = false;
    return;
  }
  const element = event.target instanceof Element
    ? event.target.closest<HTMLElement>(".watch-node")
    : undefined;
  const node = findWatchTreeNode(watchConfig.root, element?.dataset.watchNodeId ?? "");
  if (node?.type === "category" && node.children.length > 0) {
    toggleCollapsedWatchNode(node.id);
  }
}

function handleWatchNodeContextMenu(event: MouseEvent): void {
  const element = event.target instanceof Element
    ? event.target.closest<HTMLElement>(".watch-node")
    : undefined;
  const node = findWatchTreeNode(watchConfig.root, element?.dataset.watchNodeId ?? "");
  if (!node) {
    return;
  }
  event.preventDefault();
  elements.watchContextMenu.innerHTML = node.type === "category"
    ? `
      <button data-watch-menu-action="add-category" data-watch-id="${escapeHtml(node.id)}" type="button">添加子分类</button>
      <button data-watch-menu-action="add-stock" data-watch-id="${escapeHtml(node.id)}" type="button">添加子股票</button>
      <button data-watch-menu-action="edit" data-watch-id="${escapeHtml(node.id)}" type="button">编辑节点</button>
      <button data-watch-menu-action="delete" data-watch-id="${escapeHtml(node.id)}" type="button">删除节点</button>
    `
    : `
      <button data-watch-menu-action="edit" data-watch-id="${escapeHtml(node.id)}" type="button">编辑股票</button>
      <button data-watch-menu-action="delete" data-watch-id="${escapeHtml(node.id)}" type="button">删除股票</button>
    `;
  elements.watchContextMenu.style.left = `${event.clientX}px`;
  elements.watchContextMenu.style.top = `${event.clientY}px`;
  elements.watchContextMenu.hidden = false;
}

function handleWatchPanelContextMenu(event: MouseEvent): void {
  if (watchConfig.root) {
    return;
  }
  if (event.target instanceof Element && event.target.closest(".watch-node")) {
    return;
  }
  event.preventDefault();
  elements.watchContextMenu.innerHTML = '<button data-watch-menu-action="create-category" type="button">创建分类</button>';
  elements.watchContextMenu.style.left = `${event.clientX}px`;
  elements.watchContextMenu.style.top = `${event.clientY}px`;
  elements.watchContextMenu.hidden = false;
}

function handleWatchContextMenuClick(event: MouseEvent): void {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("button[data-watch-menu-action]")
    : undefined;
  if (!button) {
    return;
  }
  const id = button.dataset.watchId ?? "";
  switch (button.dataset.watchMenuAction) {
    case "create-category":
      openWatchNodeDialog({ kind: "create-category" });
      break;
    case "add-category":
      openWatchNodeDialog({ kind: "add", parentId: id, nodeType: "category" });
      break;
    case "add-stock":
      openWatchNodeDialog({ kind: "add", parentId: id, nodeType: "stock" });
      break;
    case "edit":
      openWatchNodeDialog({ kind: "edit", nodeId: id });
      break;
    case "delete":
      void deleteWatchNode(id);
      break;
  }
  closeWatchContextMenu();
}

function closeWatchContextMenu(): void {
  elements.watchContextMenu.hidden = true;
}

function toggleCollapsedWatchNode(id: string): void {
  if (collapsedWatchNodes.has(id)) {
    collapsedWatchNodes.delete(id);
  } else {
    collapsedWatchNodes.add(id);
  }
  renderWatchTree();
}

function beginWatchPan(event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }
  closeWatchContextMenu();
  watchPan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: elements.watchPanel.scrollLeft,
    scrollTop: elements.watchPanel.scrollTop,
    dragged: false
  };
}

function moveWatchPan(event: PointerEvent): void {
  if (!watchPan || watchPan.pointerId !== event.pointerId) {
    return;
  }
  const offsetX = event.clientX - watchPan.startX;
  const offsetY = event.clientY - watchPan.startY;
  if (!watchPan.dragged && Math.hypot(offsetX, offsetY) < 4) {
    return;
  }
  watchPan.dragged = true;
  elements.watchPanel.classList.add("dragging");
  elements.watchPanel.setPointerCapture(event.pointerId);
  elements.watchPanel.scrollLeft = watchPan.scrollLeft - offsetX;
  elements.watchPanel.scrollTop = watchPan.scrollTop - offsetY;
}

function endWatchPan(event: PointerEvent): void {
  if (!watchPan || watchPan.pointerId !== event.pointerId) {
    return;
  }
  suppressWatchNodeClick = watchPan.dragged;
  watchPan = undefined;
  elements.watchPanel.classList.remove("dragging");
  if (elements.watchPanel.hasPointerCapture(event.pointerId)) {
    elements.watchPanel.releasePointerCapture(event.pointerId);
  }
  window.setTimeout(() => {
    suppressWatchNodeClick = false;
  }, 0);
}

function openWatchNodeDialog(action: WatchDialogAction): void {
  const existing = action.kind === "edit"
    ? findWatchTreeNode(watchConfig.root, action.nodeId)
    : undefined;
  watchDialogAction = action;
  elements.watchNodeDialogTitle.textContent = action.kind === "edit"
    ? "编辑节点"
    : action.kind === "create-category" ? "创建分类" : "添加节点";
  elements.watchNodeType.value = existing?.type
    ?? (action.kind === "add" ? action.nodeType : "category");
  elements.watchNodeType.disabled = action.kind !== "add";
  elements.watchNodeName.value = existing?.name ?? "";
  elements.watchNodeSecid.value = existing?.type === "stock" ? existing.secid : "";
  selectedWatchStock = existing?.type === "stock"
    ? { secid: existing.secid, code: existing.secid.slice(2), name: existing.name }
    : undefined;
  elements.watchStockResults.hidden = true;
  elements.watchStockResults.innerHTML = "";
  elements.watchNodeError.textContent = "";
  syncWatchNodeSecidVisibility();
  elements.watchNodeDialog.showModal();
  elements.watchNodeName.focus();
}

function syncWatchNodeSecidVisibility(): void {
  const isStock = elements.watchNodeType.value === "stock";
  elements.searchWatchStock.hidden = !isStock;
  elements.watchStockResults.hidden = true;
  elements.watchNodeSecidLabel.hidden = !isStock;
  elements.watchNodeSecid.hidden = !isStock;
}

function handleWatchNodeNameInput(): void {
  if (elements.watchNodeType.value !== "stock") {
    return;
  }
  if (selectedWatchStock?.name !== elements.watchNodeName.value.trim()) {
    selectedWatchStock = undefined;
    elements.watchNodeSecid.value = "";
  }
}

async function searchWatchStocks(): Promise<void> {
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
        button.addEventListener("click", () => selectWatchStock(button));
      });
    }
    elements.watchStockResults.hidden = false;
  } catch (error) {
    elements.watchNodeError.textContent = getErrorMessage(error);
  }
}

function selectWatchStock(button: HTMLButtonElement): void {
  selectedWatchStock = {
    secid: button.dataset.stockSecid ?? "",
    code: button.dataset.stockCode ?? "",
    name: button.dataset.stockName ?? "",
    marketName: button.dataset.stockMarket || undefined
  };
  elements.watchNodeName.value = selectedWatchStock.name;
  elements.watchNodeSecid.value = selectedWatchStock.secid;
  elements.watchStockResults.hidden = true;
}

async function saveWatchNode(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!watchDialogAction) {
    return;
  }
  const name = elements.watchNodeName.value.trim();
  if (!name) {
    elements.watchNodeError.textContent = "节点名称不能为空";
    return;
  }
  try {
    const type = elements.watchNodeType.value === "stock" ? "stock" : "category";
    const existing = watchDialogAction.kind === "edit"
      ? findWatchTreeNode(watchConfig.root, watchDialogAction.nodeId)
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
    if (watchDialogAction.kind === "create-category") {
      if (node.type !== "category") {
        throw new Error("请创建分类节点");
      }
      watchConfig = { root: node };
    } else if (watchDialogAction.kind === "add") {
      if (!watchConfig.root) {
        throw new Error("请先创建分类");
      }
      watchConfig = {
        root: appendWatchTreeChild(watchConfig.root, watchDialogAction.parentId, node)
      };
    } else {
      if (!watchConfig.root) {
        throw new Error("盯盘脑图尚未配置");
      }
      watchConfig = { root: replaceWatchTreeNode(watchConfig.root, node) };
    }
    await persistWatchTree();
    elements.watchNodeDialog.close();
  } catch (error) {
    elements.watchNodeError.textContent = getErrorMessage(error);
  }
}

async function deleteWatchNode(id: string): Promise<void> {
  if (!watchConfig.root || !confirm("确定删除该节点及其所有子节点吗？")) {
    return;
  }
  watchConfig = { root: removeWatchTreeNode(watchConfig.root, id) };
  collapsedWatchNodes.delete(id);
  await persistWatchTree();
}

async function persistWatchTree(): Promise<void> {
  watchConfig = await api.saveWatchTree(watchConfig);
  renderWatchTree();
  await loadWatchMarketData();
}

async function loadWatchMarketData(): Promise<void> {
  await updateWatchMarketData((secids) => api.getWatchMarketData(secids), "正在加载行情...");
}

async function refreshWatchQuotes(): Promise<void> {
  await updateWatchMarketData((secids) => api.refreshWatchMarketData(secids), "正在刷新行情...");
}

async function updateWatchMarketData(
  load: (secids: string[]) => ReturnType<typeof api.getWatchMarketData>,
  loadingMessage: string
): Promise<void> {
  if (activeFeature !== "watch") {
    return;
  }
  const secids = collectStockSecids(watchConfig.root);
  if (secids.length === 0) {
    watchQuotes = new Map();
    watchTrends = new Map();
    elements.watchStatus.textContent = "尚未配置股票叶子节点";
    renderWatchTree();
    return;
  }
  elements.watchStatus.textContent = loadingMessage;
  try {
    const marketData = await load(secids);
    watchQuotes = new Map(marketData.quotes.map((quote) => [quote.secid, quote]));
    watchTrends = new Map(marketData.trends.map((trend) => [trend.secid, trend]));
    const quotes = marketData.quotes;
    const unavailable = quotes.filter((quote) => quote.errorMessage).length;
    const timeText = marketData.updatedAt ? formatDate(marketData.updatedAt) : formatDate(quotes[0].fetchedAt);
    const sourceText = marketData.fromCache ? "缓存行情时间" : "行情更新时间";
    elements.watchStatus.textContent = unavailable === 0
      ? `${sourceText}：${timeText}`
      : `${sourceText}：${timeText}，${unavailable} 只股票暂无行情`;
    renderWatchTree();
  } catch (error) {
    elements.watchStatus.textContent = getErrorMessage(error);
  }
}

function startWatchQuotePolling(): void {
  stopWatchQuotePolling();
  watchQuoteTimer = window.setInterval(() => void refreshWatchQuotes(), 15_000);
}

function stopWatchQuotePolling(): void {
  if (watchQuoteTimer !== undefined) {
    window.clearInterval(watchQuoteTimer);
  }
  watchQuoteTimer = undefined;
}

function formatChangePercent(value: number | undefined): string {
  if (value === undefined) {
    return "暂无行情";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
