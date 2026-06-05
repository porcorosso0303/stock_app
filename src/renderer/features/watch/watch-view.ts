import type {
  StockQuote,
  StockTrend,
  WatchTreeConfig,
  WatchTreeNode
} from "../../../shared/types";
import {
  averageChangePercent,
  collectStockSecids,
  formatTrendPercentClass,
  renderTrendSparklineSvg
} from "../../../shared/watch-tree";

export interface WatchViewState {
  config: WatchTreeConfig;
  quotes: Map<string, StockQuote>;
  trends: Map<string, StockTrend>;
  collapsedNodes: Set<string>;
}

export function renderWatchTree(
  container: HTMLElement,
  state: WatchViewState,
  scheduleConnectors: () => void
): void {
  if (!state.config.root) {
    container.innerHTML = `
      <div class="watch-empty">
        <p>在空白区域点击鼠标右键创建分类。</p>
      </div>
    `;
    return;
  }
  container.innerHTML = `
    <div class="watch-graph">
      <svg class="watch-connectors" aria-hidden="true"></svg>
      <ul class="watch-root">
        <li class="watch-branch">${renderWatchNode(state.config.root, undefined, 0, state)}</li>
      </ul>
    </div>
  `;
  scheduleConnectors();
}

function renderWatchNode(
  node: WatchTreeNode,
  parentId: string | undefined,
  depth: number,
  state: WatchViewState
): string {
  const isCollapsed = state.collapsedNodes.has(node.id);
  const children = node.type === "category" && !isCollapsed
    ? `<ul class="watch-children">${node.children.map((child) => `
        <li class="watch-branch">${renderWatchNode(child, node.id, depth + 1, state)}</li>
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
        title="${escapeHtml(renderWatchNodeTooltip(node, isCollapsed, state))}"
      >
        ${renderWatchNodeContent(node, state)}
      </div>
      ${collapsedMarker}
    </div>
    ${children}
  `;
}

function renderWatchNodeContent(node: WatchTreeNode, state: WatchViewState): string {
  if (node.type === "category") {
    return `<strong>${escapeHtml(node.name)}</strong>`;
  }
  const quote = state.quotes.get(node.secid);
  const trend = state.trends.get(node.secid);
  return `
    <strong>${escapeHtml(node.name)}</strong>
    <span class="watch-trend-inline">
      ${renderTrendSparklineSvg(trend?.points ?? [], quote?.changePercent)}
      <span class="${formatTrendPercentClass(quote?.changePercent)}">${escapeHtml(formatChangePercent(quote?.changePercent))}</span>
    </span>
  `;
}

function renderWatchNodeTooltip(
  node: WatchTreeNode,
  isCollapsed: boolean,
  state: WatchViewState
): string {
  if (node.type === "stock") {
    const quote = state.quotes.get(node.secid);
    const price = quote?.price === undefined ? "暂无行情" : `¥${quote.price.toFixed(2)}`;
    return `${node.name}\n${node.secid}\n价格：${price}\n涨跌幅：${formatChangePercent(quote?.changePercent)}\n右键编辑或删除`;
  }
  const leafCount = collectStockSecids(node).length;
  const average = averageChangePercent(node, state.quotes);
  const action = node.children.length > 0
    ? `左键${isCollapsed ? "展开" : "回缩"}，右键配置`
    : "右键添加子节点";
  return `${node.name}\n${leafCount} 只股票\n平均涨跌幅：${formatChangePercent(average)}\n${action}`;
}

export function formatChangePercent(value: number | undefined): string {
  if (value === undefined) {
    return "暂无行情";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
