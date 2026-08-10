export interface WatchConnectors {
  schedule(): void;
}

export type WatchConnectorTrendKind = "positive" | "negative" | "neutral";

interface WatchCanvasRootBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WatchConnectorRect {
  left: number;
  right: number;
  top: number;
  height: number;
}

interface WatchConnectorOrigin {
  left: number;
  top: number;
}

const watchConnectorColors: Record<WatchConnectorTrendKind, string> = {
  positive: "#e3483b",
  negative: "#169b62",
  neutral: "#789095"
};

export function createWatchConnectors(
  watchTree: HTMLElement,
  getZoom: () => number = () => 1
): WatchConnectors {
  let frame: number | undefined;

  function draw(): void {
    const graph = watchTree.querySelector<HTMLElement>(".watch-graph");
    const layer = watchTree.querySelector<HTMLElement>(".watch-canvas-layer");
    const spacer = watchTree.querySelector<HTMLElement>(".watch-canvas-spacer");
    const svg = watchTree.querySelector<SVGSVGElement>(".watch-connectors");
    if (!graph || !layer || !spacer || !svg) {
      return;
    }

    const zoom = normalizeZoom(getZoom());
    layer.style.transform = `scale(${zoom})`;
    const rootBounds = [...layer.querySelectorAll<HTMLElement>(".watch-root-tree[data-watch-root-id]")]
      .map((root) => {
        const rect = root.getBoundingClientRect();
        return {
          x: parseLogicalPosition(root.style.left),
          y: parseLogicalPosition(root.style.top),
          width: rect.width / zoom,
          height: rect.height / zoom
        };
      });
    const measured = measureWatchCanvas(rootBounds, 40);
    const width = Math.max(measured.width, watchTree.clientWidth / zoom);
    const height = Math.max(measured.height, watchTree.clientHeight / zoom);
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    spacer.style.width = `${width * zoom}px`;
    spacer.style.height = `${height * zoom}px`;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren();

    const layerRect = layer.getBoundingClientRect();
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
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", watchConnectorPath(parentRect, childRect, layerRect, zoom));
      path.setAttribute(
        "stroke",
        watchConnectorStrokeColor(readConnectorTrendKind(child.dataset.watchConnectorTrend))
      );
      path.setAttribute("class", "watch-connector");
      svg.append(path);
    }
  }

  return {
    schedule: () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        draw();
      });
    }
  };
}

export function measureWatchCanvas(
  roots: WatchCanvasRootBounds[],
  padding: number
): { width: number; height: number } {
  return roots.reduce((extent, root) => ({
    width: Math.max(extent.width, root.x + root.width + padding),
    height: Math.max(extent.height, root.y + root.height + padding)
  }), { width: 0, height: 0 });
}

export function watchConnectorPath(
  parent: WatchConnectorRect,
  child: WatchConnectorRect,
  origin: WatchConnectorOrigin,
  zoom: number
): string {
  const scale = normalizeZoom(zoom);
  const fromX = (parent.right - origin.left) / scale;
  const fromY = (parent.top - origin.top + parent.height / 2) / scale;
  const toX = (child.left - origin.left) / scale;
  const toY = (child.top - origin.top + child.height / 2) / scale;
  const controlOffset = Math.max(36, (toX - fromX) * 0.55);
  return `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;
}

export function watchConnectorStrokeColor(kind: WatchConnectorTrendKind): string {
  return watchConnectorColors[kind];
}

function readConnectorTrendKind(value: string | undefined): WatchConnectorTrendKind {
  return value === "positive" || value === "negative" ? value : "neutral";
}

function normalizeZoom(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function parseLogicalPosition(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
