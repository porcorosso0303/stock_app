import type {
  StockQuote,
  StockTrend,
  StockTrendPoint,
  WatchMarketCache,
  WatchRootPosition,
  WatchTreeCategoryNode,
  WatchTreeConfig,
  WatchTreeNode,
  WatchTreeWorkspace
} from "./types";
import {
  calculateSectorStrengthIndex,
  type SectorStrengthIndex
} from "./data-calc-helper";

const SECID_PATTERN = /^[01]\.\d{6}$/;
const DEFAULT_WATCH_WORKSPACE_ID = "default";
const DEFAULT_WATCH_WORKSPACE_NAME = "默认";
const DEFAULT_ROOT_X = 24;
const DEFAULT_ROOT_Y = 24;
const DEFAULT_ROOT_OFFSET = 48;

export interface WatchHoldingStock {
  secid: string;
  stockName: string;
  nodeId: string;
  workspaceId: string;
  workspaceName: string;
}

export function validateWatchTreeConfig(value: unknown): WatchTreeConfig {
  const config = requireObject(value, "盯盘脑图配置");
  if (Array.isArray(config.workspaces)) {
    return validateWorkspaceConfig(config);
  }
  if (config.root === undefined) {
    return {};
  }

  const ids = new Set<string>();
  const root = validateNode(config.root, ids);
  if (root.type !== "category") {
    throw new Error("盯盘脑图顶层节点必须是分类");
  }
  return { root };
}

export function ensureWatchWorkspaceConfig(value: unknown): WatchTreeConfig {
  const config = validateWatchTreeConfig(value);
  if (config.workspaces && config.workspaces.length > 0) {
    return config;
  }
  const roots = config.root ? [config.root] : [];
  const workspace: WatchTreeWorkspace = {
    id: DEFAULT_WATCH_WORKSPACE_ID,
    name: DEFAULT_WATCH_WORKSPACE_NAME,
    roots,
    rootPositions: defaultRootPositions(roots)
  };
  return canonicalWorkspaceConfig({
    activeWorkspaceId: workspace.id,
    workspaces: [workspace]
  });
}

export function getActiveWatchWorkspace(config: WatchTreeConfig): WatchTreeWorkspace {
  const normalized = ensureWatchWorkspaceConfig(config);
  return normalized.workspaces?.find((workspace) => workspace.id === normalized.activeWorkspaceId) ??
    normalized.workspaces?.[0] ??
    {
      id: DEFAULT_WATCH_WORKSPACE_ID,
      name: DEFAULT_WATCH_WORKSPACE_NAME,
      roots: [],
      rootPositions: {}
    };
}

export function getActiveWatchRoot(config: WatchTreeConfig): WatchTreeCategoryNode | undefined {
  return getActiveWatchWorkspace(config).roots?.[0];
}

export function getActiveWatchRoots(config: WatchTreeConfig): WatchTreeCategoryNode[] {
  return getActiveWatchWorkspace(config).roots ?? [];
}

export function updateActiveWatchWorkspace(
  config: WatchTreeConfig,
  update: (workspace: WatchTreeWorkspace) => WatchTreeWorkspace
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const activeId = normalized.activeWorkspaceId;
  return canonicalWorkspaceConfig({
    activeWorkspaceId: activeId,
    workspaces: normalized.workspaces?.map((workspace) => workspace.id === activeId
      ? update(workspace)
      : workspace)
  });
}

export function appendWatchRoot(
  config: WatchTreeConfig,
  root: WatchTreeCategoryNode,
  position: WatchRootPosition
): WatchTreeConfig {
  const nextPosition = validateRootPosition(position);
  const next = updateActiveWatchWorkspace(config, (workspace) => ({
    ...workspace,
    roots: [...workspace.roots ?? [], root],
    rootPositions: {
      ...workspace.rootPositions,
      [root.id]: nextPosition
    }
  }));
  return validateWatchTreeConfig(next);
}

export function updateWatchRootPosition(
  config: WatchTreeConfig,
  rootId: string,
  position: WatchRootPosition
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const workspace = getActiveWatchWorkspace(normalized);
  if (!workspace.roots?.some((root) => root.id === rootId)) {
    return normalized;
  }
  const nextPosition = validateRootPosition(position);
  return updateActiveWatchWorkspace(normalized, (active) => ({
    ...active,
    rootPositions: {
      ...active.rootPositions,
      [rootId]: nextPosition
    }
  }));
}

export function updateActiveWatchRoot(
  config: WatchTreeConfig,
  root: WatchTreeCategoryNode | undefined
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const activeId = normalized.activeWorkspaceId;
  const roots = root ? [root] : [];
  return canonicalWorkspaceConfig({
    activeWorkspaceId: activeId,
    workspaces: normalized.workspaces?.map((workspace) => workspace.id === activeId
      ? {
          id: workspace.id,
          name: workspace.name,
          roots,
          rootPositions: root
            ? { [root.id]: workspace.rootPositions?.[root.id] ?? defaultRootPosition(0) }
            : {}
        }
      : workspace)
  });
}

export function switchWatchWorkspace(config: WatchTreeConfig, workspaceId: string): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  if (!normalized.workspaces?.some((workspace) => workspace.id === workspaceId)) {
    return normalized;
  }
  return canonicalWorkspaceConfig({
    ...normalized,
    activeWorkspaceId: workspaceId
  });
}

export function renameWatchWorkspace(
  config: WatchTreeConfig,
  workspaceId: string,
  name: string
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const nextName = name.trim();
  if (!nextName) {
    throw new Error("展示区名称不能为空");
  }
  return canonicalWorkspaceConfig({
    ...normalized,
    workspaces: normalized.workspaces?.map((workspace) => workspace.id === workspaceId
      ? { ...workspace, name: nextName }
      : workspace)
  });
}

export function appendWatchWorkspace(
  config: WatchTreeConfig,
  workspace: WatchTreeWorkspace
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const name = workspace.name.trim();
  if (!name) {
    throw new Error("展示区名称不能为空");
  }
  const id = workspace.id.trim();
  if (!id) {
    throw new Error("展示区 id 不能为空");
  }
  if (normalized.workspaces?.some((item) => item.id === id)) {
    throw new Error("展示区 id 重复");
  }
  const roots = workspace.roots ?? (workspace.root ? [workspace.root] : []);
  return canonicalWorkspaceConfig({
    activeWorkspaceId: id,
    workspaces: [
      ...normalized.workspaces ?? [],
      {
        id,
        name,
        roots,
        rootPositions: normalizeRootPositions(roots, workspace.rootPositions)
      }
    ]
  });
}

export function deleteWatchWorkspace(config: WatchTreeConfig, workspaceId: string): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const remaining = normalized.workspaces?.filter((workspace) => workspace.id !== workspaceId) ?? [];
  if (remaining.length === 0) {
    return canonicalWorkspaceConfig({
      activeWorkspaceId: DEFAULT_WATCH_WORKSPACE_ID,
      workspaces: [{
        id: DEFAULT_WATCH_WORKSPACE_ID,
        name: DEFAULT_WATCH_WORKSPACE_NAME,
        roots: [],
        rootPositions: {}
      }]
    });
  }
  const activeWorkspaceId = normalized.activeWorkspaceId === workspaceId
    ? remaining[0].id
    : normalized.activeWorkspaceId ?? remaining[0].id;
  return canonicalWorkspaceConfig({ activeWorkspaceId, workspaces: remaining });
}

export function collectWatchTreeConfigSecids(config: WatchTreeConfig): string[] {
  const normalized = ensureWatchWorkspaceConfig(config);
  const secids = new Set<string>();
  for (const workspace of normalized.workspaces ?? []) {
    for (const root of workspace.roots ?? []) {
      for (const secid of collectStockSecids(root)) {
        secids.add(secid);
      }
    }
  }
  return [...secids];
}

export function collectHoldingStocks(config: WatchTreeConfig): WatchHoldingStock[] {
  const normalized = ensureWatchWorkspaceConfig(config);
  const bySecid = new Map<string, WatchHoldingStock>();
  for (const workspace of normalized.workspaces ?? []) {
    for (const root of workspace.roots ?? []) {
      for (const stock of collectHoldingStocksFromNode(root, workspace)) {
        if (!bySecid.has(stock.secid)) {
          bySecid.set(stock.secid, stock);
        }
      }
    }
  }
  return [...bySecid.values()];
}

export function validateSecid(secid: string): string {
  const value = secid.trim();
  if (!SECID_PATTERN.test(value)) {
    throw new Error("股票 secid 格式必须类似 1.600519 或 0.300750");
  }
  return value;
}

function validateWorkspaceConfig(config: Record<string, unknown>): WatchTreeConfig {
  const ids = new Set<string>();
  const workspaces = (config.workspaces as unknown[]).map((value) => validateWorkspace(value, ids));
  if (workspaces.length === 0) {
    return canonicalWorkspaceConfig({
      activeWorkspaceId: DEFAULT_WATCH_WORKSPACE_ID,
      workspaces: [{
        id: DEFAULT_WATCH_WORKSPACE_ID,
        name: DEFAULT_WATCH_WORKSPACE_NAME,
        roots: [],
        rootPositions: {}
      }]
    });
  }
  const requestedActiveId = typeof config.activeWorkspaceId === "string"
    ? config.activeWorkspaceId
    : undefined;
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === requestedActiveId)
    ? requestedActiveId
    : workspaces[0].id;
  return canonicalWorkspaceConfig({ activeWorkspaceId, workspaces });
}

function validateWorkspace(value: unknown, workspaceIds: Set<string>): WatchTreeWorkspace {
  const workspace = requireObject(value, "盯盘展示区");
  const id = requireNonEmptyString(workspace.id, "展示区 id");
  if (workspaceIds.has(id)) {
    throw new Error(`展示区 id 重复: ${id}`);
  }
  workspaceIds.add(id);
  const name = requireNonEmptyString(workspace.name, "展示区名称");
  const rawRoots = Array.isArray(workspace.roots)
    ? workspace.roots
    : workspace.root === undefined ? [] : [workspace.root];
  const nodeIds = new Set<string>();
  const roots = rawRoots.map((rawRoot) => {
    const root = validateNode(rawRoot, nodeIds);
    if (root.type !== "category") {
      throw new Error("盯盘脑图顶层节点必须是分类");
    }
    return root;
  });
  const rawPositions = workspace.rootPositions === undefined
    ? undefined
    : requireObject(workspace.rootPositions, "根节点位置");
  if (rawPositions) {
    const rootIds = new Set(roots.map((root) => root.id));
    for (const rootId of Object.keys(rawPositions)) {
      if (!rootIds.has(rootId)) {
        throw new Error(`根节点位置引用不存在：${rootId}`);
      }
    }
  }
  return {
    id,
    name,
    roots,
    rootPositions: normalizeRootPositions(roots, rawPositions)
  };
}

function canonicalWorkspaceConfig(config: WatchTreeConfig): WatchTreeConfig {
  const active = config.workspaces?.find((workspace) => workspace.id === config.activeWorkspaceId) ??
    config.workspaces?.[0];
  return {
    activeWorkspaceId: active?.id,
    workspaces: config.workspaces ?? []
  };
}

function normalizeRootPositions(
  roots: WatchTreeCategoryNode[],
  rawPositions: Record<string, unknown> | undefined
): Record<string, WatchRootPosition> {
  return Object.fromEntries(roots.map((root, index) => {
    const rawPosition = rawPositions?.[root.id];
    return [root.id, rawPosition === undefined
      ? defaultRootPosition(index)
      : validateRootPosition(rawPosition)];
  }));
}

function defaultRootPositions(
  roots: WatchTreeCategoryNode[]
): Record<string, WatchRootPosition> {
  return Object.fromEntries(roots.map((root, index) => [root.id, defaultRootPosition(index)]));
}

function defaultRootPosition(index: number): WatchRootPosition {
  return {
    x: DEFAULT_ROOT_X + index * DEFAULT_ROOT_OFFSET,
    y: DEFAULT_ROOT_Y + index * DEFAULT_ROOT_OFFSET
  };
}

function validateRootPosition(value: unknown): WatchRootPosition {
  const position = requireObject(value, "根节点坐标");
  const x = position.x;
  const y = position.y;
  if (
    typeof x !== "number" || !Number.isFinite(x) || x < 0 ||
    typeof y !== "number" || !Number.isFinite(y) || y < 0
  ) {
    throw new Error("根节点坐标必须是有限非负数");
  }
  return { x, y };
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

export function collectStockSecidsFromRoots(roots: WatchTreeCategoryNode[]): string[] {
  return roots.flatMap((root) => collectStockSecids(root));
}

function collectHoldingStocksFromNode(
  root: WatchTreeNode | undefined,
  workspace: WatchTreeWorkspace
): WatchHoldingStock[] {
  if (!root) {
    return [];
  }
  if (root.type === "stock") {
    return root.isHolding
      ? [{
          secid: root.secid,
          stockName: root.name,
          nodeId: root.id,
          workspaceId: workspace.id,
          workspaceName: workspace.name
        }]
      : [];
  }
  return root.children.flatMap((child) => collectHoldingStocksFromNode(child, workspace));
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

export interface UpDownStockCount {
  up: number;
  down: number;
}

export function countUpDownStocks(
  node: WatchTreeNode,
  quotes: ReadonlyMap<string, StockQuote>
): UpDownStockCount {
  return collectStockSecids(node)
    .map((secid) => quotes.get(secid)?.changePercent)
    .reduce<UpDownStockCount>((count, value) => {
      if (value === undefined || value === 0) {
        return count;
      }
      return value > 0
        ? { ...count, up: count.up + 1 }
        : { ...count, down: count.down + 1 };
    }, { up: 0, down: 0 });
}

export function sortWatchChildrenByChangePercent(
  node: WatchTreeCategoryNode,
  quotes: ReadonlyMap<string, StockQuote>
): WatchTreeNode[] {
  return [...node.children].sort((left, right) => {
    const leftScore = childChangePercent(left, quotes);
    const rightScore = childChangePercent(right, quotes);
    if (leftScore === undefined && rightScore === undefined) {
      return 0;
    }
    if (leftScore === undefined) {
      return 1;
    }
    if (rightScore === undefined) {
      return -1;
    }
    return rightScore - leftScore;
  });
}

function childChangePercent(
  node: WatchTreeNode,
  quotes: ReadonlyMap<string, StockQuote>
): number | undefined {
  return node.type === "stock"
    ? quotes.get(node.secid)?.changePercent
    : averageChangePercent(node, quotes);
}

export function categoryStrengthIndex(
  node: WatchTreeNode,
  quotes: ReadonlyMap<string, StockQuote>
): SectorStrengthIndex {
  return calculateSectorStrengthIndex(
    collectStockSecids(node).map((secid) => quotes.get(secid) ?? { secid })
  );
}

export interface CategoryStrengthHistoryPoint {
  tradingDate: string;
  score: number;
  index: SectorStrengthIndex;
}

export function categoryStrengthHistory(
  node: WatchTreeNode,
  history: WatchMarketCache[]
): CategoryStrengthHistoryPoint[] {
  const secids = collectStockSecids(node);
  return [...history]
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
    .flatMap((day) => {
      const quotesBySecid = new Map(day.quotes.map((quote) => [quote.secid, quote]));
      const index = calculateSectorStrengthIndex(
        secids.map((secid) => quotesBySecid.get(secid) ?? { secid })
      );
      return index.score === undefined
        ? []
        : [{ tradingDate: day.tradingDate, score: index.score, index }];
    });
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
    tradingDate: formatTrendPointDate(quote.fetchedAt),
    fetchedAt: quote.fetchedAt,
    points: []
  };
  if (quote.changePercent === undefined) {
    return { ...base, fetchedAt: quote.fetchedAt };
  }

  const time = formatTrendPointTime(quote.fetchedAt);
  if (!isTradingMinute(time)) {
    return { ...base, fetchedAt: quote.fetchedAt };
  }
  if (base.points.some((point) => trendMinute(point.time) > trendMinute(time))) {
    return { ...base, fetchedAt: quote.fetchedAt };
  }
  const nextPoint: StockTrendPoint = {
    time,
    changePercent: quote.changePercent
  };
  if (quote.price !== undefined) {
    nextPoint.price = quote.price;
  }
  const points = [
    ...base.points.filter((point) => point.time !== time),
    nextPoint
  ].sort((left, right) => trendMinute(left.time) - trendMinute(right.time));
  return {
    secid: quote.secid,
    tradingDate: base.tradingDate,
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
  const useIntradayTimeScale = points.every((point) => intradayTimelineIndex(point.time) !== undefined);
  const coordinates = points.map((point, index) => {
    const x = useIntradayTimeScale
      ? ((intradayTimelineIndex(point.time) ?? 0) / FULL_DAY_TREND_INTERVALS) * width
      : points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
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
  latestChangePercent: number | undefined,
  width = 96,
  height = 36
): string {
  const centerY = height / 2;
  const segments = normalizeTrendSegments(points, width, height);
  const lineKind = trendLineKind(latestChangePercent);
  const paths = segments.map((segment) => (
    `<path class="watch-trend-line watch-trend-${lineKind}" d="${segment.path}" />`
  )).join("");
  return [
    `<svg class="watch-trend-sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true">`,
    `<line class="watch-trend-zero-axis" x1="0" y1="${centerY}" x2="${width}" y2="${centerY}" />`,
    paths,
    "</svg>"
  ].join("");
}

function trendLineKind(value: number | undefined): "positive" | "negative" | "neutral" {
  if (value === undefined || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
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

export function findWatchNodeInRoots(
  roots: WatchTreeCategoryNode[],
  id: string
): WatchTreeNode | undefined {
  for (const root of roots) {
    const found = findWatchTreeNode(root, id);
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

export function appendWatchForestChild(
  config: WatchTreeConfig,
  parentId: string,
  child: WatchTreeNode
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const roots = getActiveWatchRoots(normalized);
  const parent = findWatchNodeInRoots(roots, parentId);
  if (!parent || parent.type !== "category") {
    return normalized;
  }
  const nextRoots = roots.map((root) => findWatchTreeNode(root, parentId)
    ? appendWatchTreeChild(root, parentId, child)
    : root);
  return updateActiveWatchWorkspace(normalized, (workspace) => ({
    ...workspace,
    roots: nextRoots
  }));
}

export function replaceWatchTreeNode(
  root: WatchTreeCategoryNode,
  replacement: WatchTreeNode
): WatchTreeCategoryNode {
  if (root.id === replacement.id) {
    if (replacement.type !== "category") {
      throw new Error("盯盘脑图顶层节点必须是分类");
    }
    return replacement;
  }
  return mapCategory(root, (node) => node, replacement);
}

export function replaceWatchForestNode(
  config: WatchTreeConfig,
  replacement: WatchTreeNode
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const roots = getActiveWatchRoots(normalized);
  const existing = findWatchNodeInRoots(roots, replacement.id);
  if (!existing) {
    return normalized;
  }
  const nextRoots = roots.map((root) => findWatchTreeNode(root, replacement.id)
    ? replaceWatchTreeNode(root, replacement)
    : root);
  return updateActiveWatchWorkspace(normalized, (workspace) => ({
    ...workspace,
    roots: nextRoots
  }));
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

export function removeWatchForestNode(
  config: WatchTreeConfig,
  id: string
): WatchTreeConfig {
  const normalized = ensureWatchWorkspaceConfig(config);
  const workspace = getActiveWatchWorkspace(normalized);
  const roots = workspace.roots ?? [];
  if (!findWatchNodeInRoots(roots, id)) {
    return normalized;
  }
  const nextRoots = roots.flatMap((root) => {
    const nextRoot = removeWatchTreeNode(root, id);
    return nextRoot ? [nextRoot] : [];
  });
  const nextPositions = Object.fromEntries(Object.entries(workspace.rootPositions ?? {})
    .filter(([rootId]) => nextRoots.some((root) => root.id === rootId)));
  return updateActiveWatchWorkspace(normalized, (active) => ({
    ...active,
    roots: nextRoots,
    rootPositions: nextPositions
  }));
}

export function moveWatchForestNode(
  config: WatchTreeConfig,
  nodeId: string,
  targetParentId: string
): WatchTreeConfig {
  if (nodeId === targetParentId) {
    return config;
  }
  const normalized = ensureWatchWorkspaceConfig(config);
  const workspace = getActiveWatchWorkspace(normalized);
  const roots = workspace.roots ?? [];
  const source = locateWatchForestNode(roots, nodeId);
  const target = findWatchNodeInRoots(roots, targetParentId);
  if (!source || !target || target.type !== "category") {
    return config;
  }
  if (source.parent?.id === target.id) {
    return config;
  }
  if (source.node.type === "category" && findWatchTreeNode(source.node, targetParentId)) {
    return config;
  }
  if (target.children.some((child) => child.type !== source.node.type)) {
    return config;
  }

  const rootsWithoutSource = roots.flatMap((root) => {
    const nextRoot = removeWatchTreeNode(root, nodeId);
    return nextRoot ? [nextRoot] : [];
  });
  if (!findWatchNodeInRoots(rootsWithoutSource, targetParentId)) {
    return config;
  }
  const nextRoots = rootsWithoutSource.map((root) => (
    findWatchTreeNode(root, targetParentId)
      ? appendWatchTreeChild(root, targetParentId, source.node)
      : root
  ));
  const nextPositions = Object.fromEntries(Object.entries(workspace.rootPositions ?? {})
    .filter(([rootId]) => nextRoots.some((root) => root.id === rootId)));
  return updateActiveWatchWorkspace(normalized, (active) => ({
    ...active,
    roots: nextRoots,
    rootPositions: nextPositions
  }));
}

export function moveWatchTreeNode(
  root: WatchTreeCategoryNode,
  nodeId: string,
  targetParentId: string
): WatchTreeCategoryNode {
  if (nodeId === targetParentId) {
    return root;
  }
  const source = locateWatchTreeNode(root, nodeId);
  const target = findWatchTreeNode(root, targetParentId);
  if (!source || !source.parent || !target || target.type !== "category") {
    return root;
  }
  if (source.parent.id === target.id) {
    return root;
  }
  if (source.node.type === "category" && findWatchTreeNode(source.node, targetParentId)) {
    return root;
  }
  if (target.children.some((child) => child.type !== source.node.type)) {
    return root;
  }
  const withoutSource = removeWatchTreeNode(root, nodeId);
  if (!withoutSource) {
    return root;
  }
  return appendWatchTreeChild(withoutSource, targetParentId, source.node);
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

interface LocatedWatchTreeNode {
  node: WatchTreeNode;
  parent?: WatchTreeCategoryNode;
}

function locateWatchForestNode(
  roots: WatchTreeCategoryNode[],
  id: string
): LocatedWatchTreeNode | undefined {
  for (const root of roots) {
    const found = locateWatchTreeNode(root, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function locateWatchTreeNode(
  root: WatchTreeNode | undefined,
  id: string,
  parent?: WatchTreeCategoryNode
): LocatedWatchTreeNode | undefined {
  if (!root) {
    return undefined;
  }
  if (root.id === id) {
    return { node: root, parent };
  }
  if (root.type === "stock") {
    return undefined;
  }
  for (const child of root.children) {
    const found = locateWatchTreeNode(child, id, root);
    if (found) {
      return found;
    }
  }
  return undefined;
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
    const industryPosition = validateIndustryPosition(node.industryPosition);
    const isHolding = validateIsHolding(node.isHolding);
    return {
      id,
      type: "stock",
      name,
      secid: validateSecid(requireNonEmptyString(node.secid, "股票 secid")),
      ...(industryPosition ? { industryPosition } : {}),
      ...(isHolding ? { isHolding } : {})
    };
  }
  throw new Error("盯盘脑图节点类型必须是 category 或 stock");
}

function validateIndustryPosition(value: unknown): "leader1" | "leader2" | "leader3" | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "leader1" || value === "leader2" || value === "leader3") {
    return value;
  }
  throw new Error("股票行业地位必须是 leader1、leader2 或 leader3");
}

function validateIsHolding(value: unknown): boolean | undefined {
  if (value === undefined || value === false) {
    return undefined;
  }
  if (value === true) {
    return true;
  }
  throw new Error("股票持仓股属性必须是布尔值");
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.includes("T") ? value.slice(11, 16) : value.slice(0, 5);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("hour")}:${byType.get("minute")}`;
}

function formatTrendPointDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function isTradingMinute(time: string): boolean {
  const minute = trendMinute(time);
  return (minute >= trendMinute("09:30") && minute <= trendMinute("11:30")) ||
    (minute >= trendMinute("13:00") && minute <= trendMinute("15:00"));
}

const FULL_DAY_TREND_INTERVALS = 240;
const MORNING_START_MINUTE = 9 * 60 + 30;
const MORNING_END_MINUTE = 11 * 60 + 30;
const AFTERNOON_START_MINUTE = 13 * 60 + 1;
const AFTERNOON_COMPAT_START_MINUTE = 13 * 60;
const AFTERNOON_END_MINUTE = 15 * 60;
const MORNING_TREND_POINT_COUNT = MORNING_END_MINUTE - MORNING_START_MINUTE + 1;

function intradayTimelineIndex(time: string): number | undefined {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return undefined;
  }
  const minute = trendMinute(time);
  if (minute >= MORNING_START_MINUTE && minute <= MORNING_END_MINUTE) {
    return minute - MORNING_START_MINUTE;
  }
  if (minute >= AFTERNOON_START_MINUTE && minute <= AFTERNOON_END_MINUTE) {
    return MORNING_TREND_POINT_COUNT + minute - AFTERNOON_START_MINUTE;
  }
  if (minute === AFTERNOON_COMPAT_START_MINUTE) {
    return MORNING_TREND_POINT_COUNT;
  }
  return undefined;
}

function trendMinute(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatSvgNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}
