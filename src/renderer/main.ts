import "./styles.css";
import { renderMarkdown } from "../shared/render-markdown";
import type {
  AppBootstrap,
  ResearchProgressEvent,
  ResearchRecord,
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
import {
  canRetryPdf,
  codexStatusMessage,
  formatElapsedTime,
  initializationErrorMessage,
  primaryActionLabel,
  researchRecordStatusMessage,
  researchStatusLabel,
  sortHistory
} from "./view-model";

const api = window.stockResearch;
const elements = {
  input: getElement<HTMLInputElement>("stock-name"),
  primaryAction: getElement<HTMLButtonElement>("primary-action"),
  taskStatus: getElement<HTMLElement>("task-status"),
  codexStatus: getElement<HTMLElement>("codex-status"),
  redetectCodex: getElement<HTMLButtonElement>("redetect-codex"),
  refreshHistory: getElement<HTMLButtonElement>("refresh-history"),
  historyList: getElement<HTMLElement>("history-list"),
  reportDirectory: getElement<HTMLElement>("report-directory"),
  configureDirectory: getElement<HTMLButtonElement>("configure-directory"),
  openPdf: getElement<HTMLButtonElement>("open-pdf"),
  retryPdf: getElement<HTMLButtonElement>("retry-pdf"),
  reportPanel: getElement<HTMLElement>("report-panel"),
  outputPanel: getElement<HTMLElement>("output-panel"),
  liveOutputScroll: getElement<HTMLElement>("live-output-scroll"),
  liveOutput: getElement<HTMLElement>("live-output"),
  workingIndicator: getElement<HTMLElement>("working-indicator"),
  workingElapsed: getElement<HTMLElement>("working-elapsed"),
  specPanel: getElement<HTMLElement>("spec-panel"),
  researchSpec: getElement<HTMLTextAreaElement>("research-spec"),
  saveSpec: getElement<HTMLButtonElement>("save-spec"),
  resetSpec: getElement<HTMLButtonElement>("reset-spec"),
  specStatus: getElement<HTMLElement>("spec-status"),
  researchSidebarContent: getElement<HTMLElement>("research-sidebar-content"),
  researchWorkspace: getElement<HTMLElement>("research-workspace"),
  watchWorkspace: getElement<HTMLElement>("watch-workspace"),
  watchStatus: getElement<HTMLElement>("watch-status"),
  refreshWatchQuotes: getElement<HTMLButtonElement>("refresh-watch-quotes"),
  toggleWatchConfig: getElement<HTMLButtonElement>("toggle-watch-config"),
  watchConfigBar: getElement<HTMLElement>("watch-config-bar"),
  createWatchRoot: getElement<HTMLButtonElement>("create-watch-root"),
  watchPanel: getElement<HTMLElement>("watch-panel"),
  watchTree: getElement<HTMLElement>("watch-tree"),
  watchContextMenu: getElement<HTMLElement>("watch-context-menu"),
  watchNodeDialog: getElement<HTMLDialogElement>("watch-node-dialog"),
  watchNodeForm: getElement<HTMLFormElement>("watch-node-form"),
  watchNodeDialogTitle: getElement<HTMLElement>("watch-node-dialog-title"),
  watchNodeType: getElement<HTMLSelectElement>("watch-node-type"),
  watchNodeName: getElement<HTMLInputElement>("watch-node-name"),
  searchWatchStock: getElement<HTMLButtonElement>("search-watch-stock"),
  watchStockResults: getElement<HTMLElement>("watch-stock-results"),
  watchNodeSecidLabel: getElement<HTMLElement>("watch-node-secid-label"),
  watchNodeSecid: getElement<HTMLInputElement>("watch-node-secid"),
  watchNodeError: getElement<HTMLElement>("watch-node-error"),
  cancelWatchNode: getElement<HTMLButtonElement>("cancel-watch-node")
};

let state: AppBootstrap;
let running = false;
let selectedRecord: ResearchRecord | undefined;
let workingStartedAt: number | undefined;
let workingTimer: number | undefined;
let activeFeature: "research" | "watch" = "research";
let watchConfig: WatchTreeConfig = {};
let watchTreeLoaded = false;
let watchConfiguring = false;
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

type WatchDialogAction =
  | { kind: "create-root" }
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
  bindEvents();
  state = await api.getBootstrap();
  elements.researchSpec.value = await api.getResearchSpec();
  renderBootstrap();
  api.onResearchEvent(handleProgress);
}

function bindEvents(): void {
  elements.primaryAction.addEventListener("click", () => void handlePrimaryAction());
  elements.configureDirectory.addEventListener("click", () => void chooseDirectory());
  elements.redetectCodex.addEventListener("click", () => void redetectCodex());
  elements.refreshHistory.addEventListener("click", () => void refreshHistory());
  elements.openPdf.addEventListener("click", () => void openSelectedPdf());
  elements.retryPdf.addEventListener("click", () => void retrySelectedPdf());
  elements.saveSpec.addEventListener("click", () => void saveResearchSpec());
  elements.resetSpec.addEventListener("click", () => void resetResearchSpec());
  elements.refreshWatchQuotes.addEventListener("click", () => void refreshWatchQuotes());
  elements.toggleWatchConfig.addEventListener("click", toggleWatchConfig);
  elements.createWatchRoot.addEventListener("click", () => openWatchNodeDialog({
    kind: "create-root"
  }));
  elements.watchNodeType.addEventListener("change", syncWatchNodeSecidVisibility);
  elements.watchNodeName.addEventListener("input", handleWatchNodeNameInput);
  elements.searchWatchStock.addEventListener("click", () => void searchWatchStocks());
  elements.watchNodeForm.addEventListener("submit", (event) => void saveWatchNode(event));
  elements.cancelWatchNode.addEventListener("click", () => elements.watchNodeDialog.close());
  elements.watchTree.addEventListener("click", handleWatchNodeClick);
  elements.watchTree.addEventListener("contextmenu", handleWatchNodeContextMenu);
  elements.watchContextMenu.addEventListener("click", handleWatchContextMenuClick);
  elements.watchPanel.addEventListener("pointerdown", beginWatchPan);
  elements.watchPanel.addEventListener("pointermove", moveWatchPan);
  elements.watchPanel.addEventListener("pointerup", endWatchPan);
  elements.watchPanel.addEventListener("pointercancel", endWatchPan);
  elements.watchPanel.addEventListener("scroll", closeWatchContextMenu);
  document.addEventListener("click", closeWatchContextMenu);
  window.addEventListener("resize", scheduleWatchConnectors);
  document.querySelectorAll<HTMLButtonElement>(".feature-button").forEach((button) => {
    button.addEventListener("click", () => {
      void activateFeature(button.dataset.feature === "watch" ? "watch" : "research");
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      selectTab(name === "output" || name === "spec" ? name : "report");
    });
  });
}

async function activateFeature(feature: "research" | "watch"): Promise<void> {
  activeFeature = feature;
  elements.researchSidebarContent.hidden = feature !== "research";
  elements.researchWorkspace.hidden = feature !== "research";
  elements.watchWorkspace.hidden = feature !== "watch";
  document.querySelectorAll<HTMLButtonElement>(".feature-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.feature === feature);
  });
  if (feature === "watch") {
    if (!watchTreeLoaded) {
      await loadWatchTree();
    }
    startWatchQuotePolling();
    await loadWatchMarketData();
  } else {
    stopWatchQuotePolling();
  }
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

function toggleWatchConfig(): void {
  watchConfiguring = !watchConfiguring;
  elements.watchConfigBar.hidden = !watchConfiguring;
  elements.toggleWatchConfig.textContent = watchConfiguring ? "完成配置" : "配置脑图";
  renderWatchTree();
}

function renderWatchTree(): void {
  elements.createWatchRoot.hidden = Boolean(watchConfig.root);
  if (!watchConfig.root) {
    elements.watchTree.innerHTML = `
      <div class="watch-empty">
        <h2>尚未配置盯盘脑图</h2>
        <p>${watchConfiguring ? "点击上方“创建根分类”开始配置。" : "点击“配置脑图”，创建分类节点和股票叶子节点。"}</p>
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

function handleWatchContextMenuClick(event: MouseEvent): void {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("button[data-watch-menu-action]")
    : undefined;
  if (!button) {
    return;
  }
  const id = button.dataset.watchId ?? "";
  switch (button.dataset.watchMenuAction) {
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
    : action.kind === "create-root" ? "创建根分类" : "添加节点";
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
    if (watchDialogAction.kind === "create-root") {
      if (node.type !== "category") {
        throw new Error("根节点必须是分类");
      }
      watchConfig = { root: node };
    } else if (watchDialogAction.kind === "add") {
      if (!watchConfig.root) {
        throw new Error("请先创建根分类");
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

function renderBootstrap(): void {
  elements.reportDirectory.textContent = state.config.reportDirectory ?? "尚未配置";
  elements.codexStatus.textContent = codexStatusMessage(state.codex);
  renderHistory();
  renderPrimaryAction();
}

async function handlePrimaryAction(): Promise<void> {
  if (running) {
    await api.cancelResearch();
    elements.taskStatus.textContent = "正在停止调研...";
    return;
  }

  if (!elements.input.value.trim()) {
    elements.taskStatus.textContent = "请输入A股标的名称";
    elements.input.focus();
    return;
  }

  if (!state.config.reportDirectory && !await chooseDirectory()) {
    elements.taskStatus.textContent = "未选择报告目录，调研未启动";
    return;
  }

  running = true;
  selectedRecord = undefined;
  elements.liveOutput.textContent = "";
  elements.reportPanel.innerHTML = '<div class="empty-state"><h2>正在调研</h2><p>筛选后的中文进展可在“实时输出”标签页查看。</p></div>';
  selectTab("output");
  renderPrimaryAction();
  startWorkingIndicator();

  try {
    const record = await api.startResearch(elements.input.value);
    elements.taskStatus.textContent = researchRecordStatusMessage(record);
    await refreshHistory(record.id);
  } catch (error) {
    elements.taskStatus.textContent = getErrorMessage(error);
  } finally {
    running = false;
    renderPrimaryAction();
    stopWorkingIndicator();
  }
}

async function chooseDirectory(): Promise<string | undefined> {
  const directory = await api.chooseReportDirectory();
  if (directory) {
    state.config.reportDirectory = directory;
    elements.reportDirectory.textContent = directory;
  }
  return directory;
}

async function redetectCodex(): Promise<void> {
  elements.codexStatus.textContent = "正在检测 Codex CLI...";
  state.codex = await api.redetectCodex();
  elements.codexStatus.textContent = codexStatusMessage(state.codex);
}

async function refreshHistory(selectId?: string): Promise<void> {
  state.history = await api.listHistory();
  renderHistory();
  if (selectId) {
    await selectHistory(selectId);
  }
}

function renderHistory(): void {
  const records = sortHistory(state.history);
  if (records.length === 0) {
    elements.historyList.innerHTML = '<p class="muted">暂无调研记录</p>';
    return;
  }
  elements.historyList.innerHTML = records.map((record) => `
    <button class="history-item${record.id === selectedRecord?.id ? " selected" : ""}" data-record-id="${escapeHtml(record.id)}" type="button">
      <strong>${escapeHtml(record.stockName)}</strong>
      <span>${formatDate(record.createdAt)}</span>
      <em>${researchStatusLabel(record.status)}</em>
    </button>
  `).join("");
  elements.historyList.querySelectorAll<HTMLButtonElement>(".history-item").forEach((button) => {
    button.addEventListener("click", () => void selectHistory(button.dataset.recordId ?? ""));
  });
}

async function selectHistory(id: string): Promise<void> {
  selectedRecord = state.history.find((record) => record.id === id);
  if (!selectedRecord) {
    return;
  }
  renderHistory();
  elements.openPdf.hidden = !selectedRecord.pdfPath;
  elements.retryPdf.hidden = !canRetryPdf(selectedRecord);
  if (selectedRecord.status === "completed" || selectedRecord.status === "completed_pdf_failed") {
    elements.reportPanel.innerHTML = renderMarkdown(await api.readReport(id));
    selectTab("report");
  } else {
    elements.reportPanel.innerHTML = `<div class="empty-state"><h2>${researchStatusLabel(selectedRecord.status)}</h2><p>${escapeHtml(selectedRecord.errorMessage ?? "该记录没有可显示的报告。")}</p></div>`;
    selectTab("report");
  }
}

async function openSelectedPdf(): Promise<void> {
  if (selectedRecord?.pdfPath) {
    await api.openPdf(selectedRecord.id);
  }
}

async function retrySelectedPdf(): Promise<void> {
  if (!selectedRecord) {
    return;
  }
  try {
    const record = await api.retryPdf(selectedRecord.id);
    elements.taskStatus.textContent = "PDF 已重新导出";
    await refreshHistory(record.id);
  } catch (error) {
    elements.taskStatus.textContent = getErrorMessage(error);
  }
}

async function saveResearchSpec(): Promise<void> {
  try {
    await api.saveResearchSpec(elements.researchSpec.value);
    elements.specStatus.textContent = "调研规范已保存，将从下一次调研开始生效。";
  } catch (error) {
    elements.specStatus.textContent = getErrorMessage(error);
  }
}

async function resetResearchSpec(): Promise<void> {
  try {
    elements.researchSpec.value = await api.resetResearchSpec();
    elements.specStatus.textContent = "已恢复初始调研规范，将从下一次调研开始生效。";
  } catch (error) {
    elements.specStatus.textContent = getErrorMessage(error);
  }
}

function handleProgress(event: ResearchProgressEvent): void {
  if (event.type === "output" && event.text) {
    elements.liveOutput.textContent += `${event.text}\n`;
    scrollLiveOutputToBottom();
  }
  if (event.type === "status" && event.status) {
    elements.taskStatus.textContent = researchStatusLabel(event.status);
  }
}

function renderPrimaryAction(): void {
  elements.primaryAction.textContent = primaryActionLabel(running);
  elements.primaryAction.classList.toggle("danger", running);
}

function startWorkingIndicator(): void {
  workingStartedAt = Date.now();
  elements.workingIndicator.hidden = false;
  renderElapsedTime();
  workingTimer = window.setInterval(renderElapsedTime, 1_000);
}

function stopWorkingIndicator(): void {
  if (workingTimer !== undefined) {
    window.clearInterval(workingTimer);
  }
  workingTimer = undefined;
  workingStartedAt = undefined;
  elements.workingIndicator.hidden = true;
}

function renderElapsedTime(): void {
  elements.workingElapsed.textContent = formatElapsedTime(
    workingStartedAt === undefined ? 0 : Date.now() - workingStartedAt
  );
}

function scrollLiveOutputToBottom(): void {
  requestAnimationFrame(() => {
    elements.liveOutputScroll.scrollTop = elements.liveOutputScroll.scrollHeight;
  });
}

function selectTab(name: "report" | "output" | "spec"): void {
  elements.reportPanel.hidden = name !== "report";
  elements.outputPanel.hidden = name !== "output";
  elements.specPanel.hidden = name !== "spec";
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
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
