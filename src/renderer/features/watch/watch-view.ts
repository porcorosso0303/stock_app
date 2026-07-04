import type {
  StockQuote,
  StockTrend,
  StockTrendPoint,
  WatchIndustryPosition,
  WatchMarketCache,
  WatchTreeConfig,
  WatchTreeCategoryNode,
  WatchTreeNode
} from "../../../shared/types";
import {
  calculateSuddenStockMove,
  type SuddenStockMove
} from "../../../shared/data-calc-helper";
import {
  averageChangePercent,
  categoryStrengthHistory,
  categoryStrengthIndex,
  collectStockSecids,
  countUpDownStocks,
  formatTrendPercentClass,
  renderTrendSparklineSvg,
  sortWatchChildrenByChangePercent
} from "../../../shared/watch-tree";

export interface WatchViewState {
  config: WatchTreeConfig;
  quotes: Map<string, StockQuote>;
  trends: Map<string, StockTrend>;
  marketHistory: WatchMarketCache[];
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
    ? `<ul class="watch-children">${sortWatchChildrenByChangePercent(node, state.quotes).map((child) => `
        <li class="watch-branch">${renderWatchNode(child, node.id, depth + 1, state)}</li>
      `).join("")}</ul>`
    : "";
  const collapsedMarker = node.type === "category" && node.children.length > 0 && isCollapsed
    ? '<span class="watch-collapsed-marker" aria-hidden="true">+</span>'
    : "";
  const anomalyAlert = node.type === "category" && isCollapsed && hasDescendantSuddenMove(node, state)
    ? renderCategoryAnomalyAlert()
    : "";
  return `
    <div class="watch-node-wrap">
      <div
        class="watch-node ${node.type}"
        data-watch-node-id="${escapeHtml(node.id)}"
        data-watch-parent-id="${escapeHtml(parentId ?? "")}"
        data-watch-depth="${depth}"
        data-watch-connector-trend="${connectorTrendKind(node, state)}"
        title="${escapeHtml(renderWatchNodeTooltip(node, isCollapsed, state))}"
      >
        ${renderWatchNodeContent(node, state)}
        ${anomalyAlert}
      </div>
      ${collapsedMarker}
    </div>
    ${children}
  `;
}

function renderWatchNodeContent(node: WatchTreeNode, state: WatchViewState): string {
  if (node.type === "category") {
    const average = averageChangePercent(node, state.quotes);
    const count = countUpDownStocks(node, state.quotes);
    const strength = categoryStrengthIndex(node, state.quotes);
    const strengthHistory = categoryStrengthHistory(node, state.marketHistory);
    return `
      <span class="watch-category-content">
        <strong>${escapeHtml(node.name)}</strong>
        <span class="watch-category-stats">
          <span class="${formatTrendPercentClass(average)}">${escapeHtml(formatChangePercent(average))}</span>
          <span class="watch-category-up-down">
            <span class="watch-up-count">${count.up}</span><span class="watch-count-separator">:</span><span class="watch-down-count">${count.down}</span>
          </span>
          <span class="watch-sector-strength-row">
            ${renderTrendSparklineSvg(strengthHistory.map((point) => ({
              time: point.tradingDate,
              changePercent: point.score
            })), strength.score, 72, 24)}
            <span class="${formatTrendPercentClass(strength.score)} watch-sector-strength-index">强度 ${escapeHtml(formatStrengthScore(strength.score))}</span>
          </span>
        </span>
      </span>
    `;
  }
  const quote = state.quotes.get(node.secid);
  const trend = state.trends.get(node.secid);
  const suddenMove = calculateSuddenStockMove(trend?.points ?? []);
  return `
    <span class="watch-stock-name${node.isHolding ? " is-holding" : ""}">
      <strong>${escapeHtml(node.name)}</strong>
      ${node.isHolding ? '<span class="watch-visually-hidden">持仓股</span>' : ""}
      ${renderSuddenMoveArrow(suddenMove)}
    </span>
    <span class="watch-trend-inline">
      ${renderTrendSparklineSvg(trend?.points ?? [], quote?.changePercent)}
      <span class="${formatTrendPercentClass(quote?.changePercent)}">${escapeHtml(formatChangePercent(quote?.changePercent))}</span>
      ${renderIndustryPositionStar(node.industryPosition)}
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
    const holdingStatus = node.isHolding ? "\n持仓状态：持仓股" : "";
    return `${node.name}\n${node.secid}${holdingStatus}\n价格：${price}\n涨跌幅：${formatChangePercent(quote?.changePercent)}\nTTM市盈率：${formatNumber(quote?.peTtm)}\n换手率：${formatChangePercent(quote?.turnoverRate)}\n流通市值：${formatMarketCap(quote?.floatMarketCap)}\n右键编辑或删除`;
  }
  const leafCount = collectStockSecids(node).length;
  const average = averageChangePercent(node, state.quotes);
  const strength = categoryStrengthIndex(node, state.quotes);
  const action = node.children.length > 0
    ? `左键${isCollapsed ? "展开" : "回缩"}，右键配置`
    : "右键添加子节点";
  return `${node.name}\n${leafCount} 只股票\n平均涨跌幅：${formatChangePercent(average)}\n板块强度指数：${formatStrengthScore(strength.score)}\n${action}`;
}

export function formatChangePercent(value: number | undefined): string {
  if (value === undefined) {
    return "暂无行情";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatStrengthScore(value: number | undefined): string {
  if (value === undefined) {
    return "暂无指数";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function connectorTrendKind(node: WatchTreeNode, state: WatchViewState): "positive" | "negative" | "neutral" {
  const changePercent = node.type === "stock"
    ? state.quotes.get(node.secid)?.changePercent
    : averageChangePercent(node, state.quotes);
  if (changePercent === undefined || changePercent === 0) {
    return "neutral";
  }
  return changePercent > 0 ? "positive" : "negative";
}

function renderIndustryPositionStar(value: WatchIndustryPosition | undefined): string {
  if (!value) {
    return "";
  }
  const label = value === "leader1" ? "龙头一" : value === "leader2" ? "龙头二" : "龙头三";
  return `<span class="watch-industry-star ${value}" title="${label}" aria-label="${label}">★</span>`;
}

function renderSuddenMoveArrow(value: SuddenStockMove | undefined): string {
  if (!value) {
    return "";
  }
  const label = value.direction === "up" ? "异动上涨" : "异动下跌";
  const arrow = value.direction === "up" ? "↗" : "↘";
  return `<span class="watch-sudden-move-arrow ${value.direction}" title="${label}" aria-label="${label}">${arrow}</span>`;
}

function renderCategoryAnomalyAlert(): string {
  return '<span class="watch-category-anomaly-alert" title="隐藏股票异动" aria-label="隐藏股票异动">!</span>';
}

function hasDescendantSuddenMove(
  node: WatchTreeCategoryNode,
  state: WatchViewState
): boolean {
  return node.children.some((child) => child.type === "stock"
    ? hasSuddenMove(state.trends.get(child.secid)?.points)
    : hasDescendantSuddenMove(child, state));
}

function hasSuddenMove(points: StockTrendPoint[] | undefined): boolean {
  return calculateSuddenStockMove(points ?? []) !== undefined;
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "暂无数据" : value.toFixed(2);
}

function formatMarketCap(value: number | undefined): string {
  if (value === undefined) {
    return "暂无数据";
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  return value.toFixed(2);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
