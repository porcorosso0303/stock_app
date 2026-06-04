import type {
  StockQuote,
  StockTrend,
  StockTrendPoint,
  WatchTreeCategoryNode,
  WatchTreeConfig,
  WatchTreeNode
} from "./types";

const SECID_PATTERN = /^[01]\.\d{6}$/;

export function validateWatchTreeConfig(value: unknown): WatchTreeConfig {
  const config = requireObject(value, "盯盘脑图配置");
  if (config.root === undefined) {
    return {};
  }

  const ids = new Set<string>();
  const root = validateNode(config.root, ids);
  if (root.type !== "category") {
    throw new Error("盯盘脑图根节点必须是分类");
  }
  return { root };
}

export function validateSecid(secid: string): string {
  const value = secid.trim();
  if (!SECID_PATTERN.test(value)) {
    throw new Error("股票 secid 格式必须类似 1.600519 或 0.300750");
  }
  return value;
}

export function collectStockSecids(root?: WatchTreeNode): string[] {
  if (!root) {
    return [];
  }
  if (root.type === "stock") {
    return [root.secid];
  }
  return root.children.flatMap(collectStockSecids);
}

export function averageChangePercent(
  node: WatchTreeNode,
  quotes: ReadonlyMap<string, StockQuote>
): number | undefined {
  const values = collectStockSecids(node)
    .map((secid) => quotes.get(secid)?.changePercent)
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface TrendSegment {
  kind: "positive" | "negative";
  path: string;
}

export function mergeQuoteIntoTrend(
  trend: StockTrend | undefined,
  quote: StockQuote
): StockTrend {
  const base: StockTrend = trend ?? {
    secid: quote.secid,
    fetchedAt: quote.fetchedAt,
    points: []
  };
  if (quote.changePercent === undefined) {
    return { ...base, fetchedAt: quote.fetchedAt };
  }

  const time = formatTrendPointTime(quote.fetchedAt);
  const nextPoint: StockTrendPoint = {
    time,
    changePercent: quote.changePercent
  };
  const points = [
    ...base.points.filter((point) => point.time !== time),
    nextPoint
  ];
  return {
    secid: quote.secid,
    fetchedAt: quote.fetchedAt,
    points
  };
}

export function normalizeTrendSegments(
  points: StockTrendPoint[],
  width: number,
  height: number
): TrendSegment[] {
  if (points.length < 2 || width <= 0 || height <= 0) {
    return [];
  }

  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.changePercent)));
  const centerY = height / 2;
  const amplitude = Math.max(1, centerY - 2);
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = centerY - (point.changePercent / maxAbs) * amplitude;
    return { x, y, value: point.changePercent };
  });

  return coordinates.slice(1).map((point, index) => {
    const previous = coordinates[index];
    return {
      kind: point.value >= 0 && previous.value >= 0 ? "positive" : "negative",
      path: `M ${formatSvgNumber(previous.x)} ${formatSvgNumber(previous.y)} L ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`
    };
  });
}

export function renderTrendSparklineSvg(
  points: StockTrendPoint[],
  width = 96,
  height = 36
): string {
  const centerY = height / 2;
  const segments = normalizeTrendSegments(points, width, height);
  const paths = segments.map((segment) => (
    `<path class="watch-trend-line watch-trend-${segment.kind}" d="${segment.path}" />`
  )).join("");
  return [
    `<svg class="watch-trend-sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true">`,
    `<line class="watch-trend-zero-axis" x1="0" y1="${centerY}" x2="${width}" y2="${centerY}" />`,
    paths,
    "</svg>"
  ].join("");
}

export function formatTrendPercentClass(value: number | undefined): string {
  if (value === undefined || value === 0) {
    return "watch-change-percent neutral";
  }
  return value > 0
    ? "watch-change-percent positive"
    : "watch-change-percent negative";
}

export function findWatchTreeNode(
  root: WatchTreeNode | undefined,
  id: string
): WatchTreeNode | undefined {
  if (!root || root.id === id) {
    return root?.id === id ? root : undefined;
  }
  if (root.type === "stock") {
    return undefined;
  }
  for (const child of root.children) {
    const found = findWatchTreeNode(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function appendWatchTreeChild(
  root: WatchTreeCategoryNode,
  parentId: string,
  child: WatchTreeNode
): WatchTreeCategoryNode {
  return mapCategory(root, (node) => node.id === parentId
    ? { ...node, children: [...node.children, child] }
    : node);
}

export function replaceWatchTreeNode(
  root: WatchTreeCategoryNode,
  replacement: WatchTreeNode
): WatchTreeCategoryNode {
  if (root.id === replacement.id) {
    if (replacement.type !== "category") {
      throw new Error("盯盘脑图根节点必须是分类");
    }
    return replacement;
  }
  return mapCategory(root, (node) => node, replacement);
}

export function removeWatchTreeNode(
  root: WatchTreeCategoryNode,
  id: string
): WatchTreeCategoryNode | undefined {
  if (root.id === id) {
    return undefined;
  }
  return {
    ...root,
    children: root.children
      .filter((child) => child.id !== id)
      .map((child) => child.type === "category"
        ? removeWatchTreeNode(child, id) ?? child
        : child)
  };
}

function mapCategory(
  root: WatchTreeCategoryNode,
  update: (node: WatchTreeCategoryNode) => WatchTreeCategoryNode,
  replacement?: WatchTreeNode
): WatchTreeCategoryNode {
  const updated = update(root);
  return {
    ...updated,
    children: updated.children.map((child) => {
      if (replacement && child.id === replacement.id) {
        return replacement;
      }
      return child.type === "category"
        ? mapCategory(child, update, replacement)
        : child;
    })
  };
}

function validateNode(value: unknown, ids: Set<string>): WatchTreeNode {
  const node = requireObject(value, "盯盘脑图节点");
  const id = requireNonEmptyString(node.id, "节点 id");
  if (ids.has(id)) {
    throw new Error(`盯盘脑图节点 id 重复：${id}`);
  }
  ids.add(id);

  const name = requireNonEmptyString(node.name, "节点名称");
  if (node.type === "category") {
    if (!Array.isArray(node.children)) {
      throw new Error("分类节点 children 必须是数组");
    }
    return {
      id,
      type: "category",
      name,
      children: node.children.map((child) => validateNode(child, ids))
    };
  }
  if (node.type === "stock") {
    return {
      id,
      type: "stock",
      name,
      secid: validateSecid(requireNonEmptyString(node.secid, "股票 secid"))
    };
  }
  throw new Error("盯盘脑图节点类型必须是 category 或 stock");
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name}不能为空`);
  }
  return value.trim();
}

function formatTrendPointTime(value: string): string {
  return value.includes("T") ? value.slice(11, 16) : value.slice(0, 5);
}

function formatSvgNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}
