export interface WatchConnectors {
  schedule(): void;
}

export type WatchConnectorTrendKind = "positive" | "negative" | "neutral";

const watchConnectorColors: Record<WatchConnectorTrendKind, string> = {
  positive: "#e3483b",
  negative: "#169b62",
  neutral: "#789095"
};

export function createWatchConnectors(watchTree: HTMLElement): WatchConnectors {
  let frame: number | undefined;

  function draw(): void {
    const graph = watchTree.querySelector<HTMLElement>(".watch-graph");
    const svg = watchTree.querySelector<SVGSVGElement>(".watch-connectors");
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

export function watchConnectorStrokeColor(kind: WatchConnectorTrendKind): string {
  return watchConnectorColors[kind];
}

function readConnectorTrendKind(value: string | undefined): WatchConnectorTrendKind {
  return value === "positive" || value === "negative" ? value : "neutral";
}
