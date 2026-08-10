# Watch Multi-Root Canvas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade every watch workspace from one tree to a persisted multi-root canvas with whole-root dragging, native two-axis scrolling, cursor-anchored zoom, and viewport-independent market updates.

**Architecture:** Keep each root as an ordinary category tree and store all roots as a forest plus a root-position table on the workspace. Keep data mutation in shared pure functions, DOM rendering and connector geometry in renderer view modules, and interaction/runtime zoom state in the watch controller. Market, statistics, and news traversal must consume the configuration forest rather than rendered or visible DOM nodes.

**Tech Stack:** TypeScript, Electron, DOM/CSS/SVG, Vitest

---

## Implementation rules

- Follow `docs/plans/2026-08-10-watch-multi-root-canvas-design.md` as the behavioral source of truth.
- Use `@superpowers:test-driven-development` for every production change.
- Keep `src/shared/watch-tree.ts` as the home of provider-independent forest mutation and traversal logic; do not create fragmented one-function source files.
- Keep `src/renderer/features/watch/watch-view.ts` responsible for watch-node markup and forest rendering, `watch-connectors.ts` responsible for connector geometry, and `watch-controller.ts` responsible for interaction/runtime state.
- Preserve legacy single-root files only while reading. New saves and exports must use `roots` and `rootPositions`.
- Do not add viewport virtualization or use DOM visibility to decide which stocks refresh.
- Do not persist zoom or scroll offsets.
- After implementation, update `docs/architecture.md`, run the full verification suite, commit, push, build, and deploy the Windows unpacked application. Do not stop or launch the user's application process.

### Task 1: Add the multi-root workspace schema and legacy migration

**Files:**
- Modify: `src/shared/types.ts:WatchTreeWorkspace`
- Modify: `src/shared/watch-tree.ts:validateWatchTreeConfig`
- Modify: `src/shared/watch-tree.ts:ensureWatchWorkspaceConfig`
- Modify: `src/shared/watch-tree.ts:validateWorkspace`
- Modify: `src/shared/watch-tree.ts:mirrorActiveWorkspaceRoot`
- Test: `tests/shared/watch-tree.test.ts`

**Step 1: Write failing schema and migration tests**

Add tests covering:

```ts
it("migrates legacy workspace root into roots and a generated position", () => {
  const config = ensureWatchWorkspaceConfig({
    activeWorkspaceId: "default",
    workspaces: [{ id: "default", name: "默认", root: category("root") }]
  });

  expect(config.workspaces?.[0].roots).toEqual([category("root")]);
  expect(config.workspaces?.[0].rootPositions?.root).toEqual(expect.objectContaining({
    x: expect.any(Number),
    y: expect.any(Number)
  }));
  expect(config.workspaces?.[0]).not.toHaveProperty("root");
});

it("rejects duplicate node ids across separate roots", () => {
  expect(() => validateWatchTreeConfig(workspaceConfig([
    category("same"),
    category("same")
  ]))).toThrow("节点 id 重复");
});

it.each([
  [{ x: -1, y: 0 }, "根节点坐标"],
  [{ x: Number.NaN, y: 0 }, "根节点坐标"]
])("rejects invalid root positions", (position, message) => {
  expect(() => validateWatchTreeConfig(workspaceConfig(
    [category("root")],
    { root: position }
  ))).toThrow(message);
});

it("rejects dangling root position ids", () => {
  expect(() => validateWatchTreeConfig(workspaceConfig(
    [category("root")],
    { missing: { x: 10, y: 20 } }
  ))).toThrow("根节点位置引用不存在");
});
```

Use local test builders in the same test file rather than adding a test helper module.

**Step 2: Run the focused test and confirm failure**

Run:

```bash
npx vitest run tests/shared/watch-tree.test.ts
```

Expected: FAIL because `WatchTreeWorkspace` has no `roots`/`rootPositions`, legacy normalization still returns `root`, and cross-root validation is absent.

**Step 3: Implement the schema and normalization**

Add to `src/shared/types.ts`:

```ts
export interface WatchRootPosition {
  x: number;
  y: number;
}

export interface WatchTreeWorkspace {
  id: string;
  name: string;
  roots: WatchTreeCategoryNode[];
  rootPositions: Record<string, WatchRootPosition>;
  /** Legacy read-only input. Normalized configs do not retain this field. */
  root?: WatchTreeCategoryNode;
}
```

Use a default logical origin and deterministic stagger for missing positions, for example:

```ts
const DEFAULT_ROOT_X = 24;
const DEFAULT_ROOT_Y = 24;
const DEFAULT_ROOT_OFFSET = 48;
```

In `ensureWatchWorkspaceConfig` and validation:

- Convert top-level `config.root` or `workspace.root` to `roots: [root]`.
- Always return every workspace with `roots` and `rootPositions`.
- Generate missing positions deterministically without changing valid stored positions.
- Validate all roots as categories with one shared node-ID set per workspace.
- Validate finite, nonnegative `x` and `y`.
- Reject position keys that are not root IDs.
- Stop emitting the legacy top-level mirror and workspace `root` in normalized output.

**Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/shared/watch-tree.test.ts tests/main/watch-tree-store.test.ts
```

Expected: PASS, with any existing single-root assertions updated to assert the normalized forest format.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/watch-tree.ts tests/shared/watch-tree.test.ts tests/main/watch-tree-store.test.ts
git commit -m "refactor: migrate watch workspaces to multi-root schema"
```

### Task 2: Add pure forest traversal and mutation operations

**Files:**
- Modify: `src/shared/watch-tree.ts:getActiveWatchRoot`
- Modify: `src/shared/watch-tree.ts:updateActiveWatchRoot`
- Modify: `src/shared/watch-tree.ts:collectWatchTreeConfigSecids`
- Modify: `src/shared/watch-tree.ts:collectHoldingStocks`
- Modify: `src/shared/watch-tree.ts:moveWatchTreeNode`
- Test: `tests/shared/watch-tree.test.ts`

**Step 1: Write failing forest-operation tests**

Cover these public operations:

```ts
it("collects stocks from every root and every workspace", () => {
  expect(collectWatchTreeConfigSecids(configWithForests())).toEqual([
    "1.600000",
    "0.000001",
    "1.688777"
  ]);
});

it("appends a root with its initial position", () => {
  const next = appendWatchRoot(config, category("second"), { x: 420, y: 180 });
  expect(getActiveWatchRoots(next).map((root) => root.id)).toEqual(["first", "second"]);
  expect(getActiveWatchWorkspace(next).rootPositions.second).toEqual({ x: 420, y: 180 });
});

it("moves a root position without changing its descendants", () => {
  const next = updateWatchRootPosition(config, "root", { x: 300, y: 240 });
  expect(findWatchNodeInRoots(getActiveWatchRoots(next), "stock")).toEqual(stock("stock"));
  expect(getActiveWatchWorkspace(next).rootPositions.root).toEqual({ x: 300, y: 240 });
});

it("reparents a whole root under a compatible category and removes its position", () => {
  const next = moveWatchForestNode(config, "source-root", "target-category");
  expect(getActiveWatchRoots(next).map((root) => root.id)).not.toContain("source-root");
  expect(findWatchNodeInRoots(getActiveWatchRoots(next), "source-root")).toBeDefined();
  expect(getActiveWatchWorkspace(next).rootPositions).not.toHaveProperty("source-root");
});

it("leaves the forest unchanged for cycles or mixed sibling types", () => {
  expect(moveWatchForestNode(config, "parent", "child")).toEqual(config);
  expect(moveWatchForestNode(config, "stock", "category-with-category-children")).toEqual(config);
});
```

Also assert that deleting a root removes its position and that deleting a nested node does not alter root positions.

**Step 2: Run the test and confirm failure**

Run:

```bash
npx vitest run tests/shared/watch-tree.test.ts
```

Expected: FAIL because the forest APIs do not exist and existing operations accept one root.

**Step 3: Implement cohesive forest helpers in `watch-tree.ts`**

Add or replace public functions with these responsibilities:

```ts
export function getActiveWatchRoots(config: WatchTreeConfig): WatchTreeCategoryNode[];
export function updateActiveWatchWorkspace(
  config: WatchTreeConfig,
  update: (workspace: WatchTreeWorkspace) => WatchTreeWorkspace
): WatchTreeConfig;
export function appendWatchRoot(
  config: WatchTreeConfig,
  root: WatchTreeCategoryNode,
  position: WatchRootPosition
): WatchTreeConfig;
export function updateWatchRootPosition(
  config: WatchTreeConfig,
  rootId: string,
  position: WatchRootPosition
): WatchTreeConfig;
export function removeWatchForestNode(config: WatchTreeConfig, nodeId: string): WatchTreeConfig;
export function moveWatchForestNode(
  config: WatchTreeConfig,
  nodeId: string,
  targetParentId: string
): WatchTreeConfig;
export function collectStockSecidsFromRoots(roots: WatchTreeCategoryNode[]): string[];
export function findWatchNodeInRoots(
  roots: WatchTreeCategoryNode[],
  nodeId: string
): WatchTreeNode | undefined;
```

Reuse the existing recursive single-tree helpers internally. Do not duplicate category/stock sibling validation. Make every operation immutable and return the original normalized config when a move is invalid.

Update `collectWatchTreeConfigSecids` and `collectHoldingStocks` to traverse `workspace.roots`. Retain narrowly scoped single-tree helpers where category statistics and recursive rendering still need them.

**Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/shared/watch-tree.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/watch-tree.ts tests/shared/watch-tree.test.ts
git commit -m "feat: add watch forest operations"
```

### Task 3: Persist, import, and export the canonical forest format

**Files:**
- Modify: `src/main/watch-tree-store.ts`
- Modify: `src/main/watch-data-transfer-service.ts`
- Test: `tests/main/watch-tree-store.test.ts`
- Test: `tests/main/watch-data-transfer-service.test.ts`

**Step 1: Write failing persistence tests**

Add tests which:

- Load a legacy single-root JSON file and receive `roots` plus `rootPositions`.
- Save a two-root workspace and assert the JSON contains `roots`/`rootPositions` and no `root` field.
- Export and import two workspaces containing multiple roots and positions without loss.
- Reject malformed imported root coordinates and duplicate IDs across roots.

Representative assertion:

```ts
expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
  workspaces: [{
    roots: [{ id: "root-a" }, { id: "root-b" }],
    rootPositions: {
      "root-a": { x: 24, y: 24 },
      "root-b": { x: 540, y: 220 }
    }
  }]
});
expect(serialized.workspaces[0]).not.toHaveProperty("root");
```

**Step 2: Run the focused tests and confirm failure**

Run:

```bash
npx vitest run tests/main/watch-tree-store.test.ts tests/main/watch-data-transfer-service.test.ts
```

Expected: FAIL on the old single-root serialized shape or missing positions.

**Step 3: Route all persistence through validation/normalization**

- Normalize immediately after reading disk or imported data.
- Write/export only the canonical result.
- Keep import transaction behavior unchanged: invalid data must not overwrite current user data.
- Preserve market-history export behavior; only change the brain-map configuration shape.

**Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/main/watch-tree-store.test.ts tests/main/watch-data-transfer-service.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/watch-tree-store.ts src/main/watch-data-transfer-service.ts tests/main/watch-tree-store.test.ts tests/main/watch-data-transfer-service.test.ts
git commit -m "feat: persist multi-root watch workspaces"
```

### Task 4: Render all roots on one logical canvas

**Files:**
- Modify: `src/renderer/features/watch/watch-view.ts`
- Modify: `src/renderer/styles.css`
- Create: `tests/renderer/watch-multi-root-canvas.test.ts`

**Step 1: Write failing view tests**

Build a minimal DOM container and call `renderWatchTree`. Assert:

```ts
expect(container.querySelectorAll("[data-watch-root-id]")).toHaveLength(2);
expect(rootElement("root-a").style.left).toBe("24px");
expect(rootElement("root-a").style.top).toBe("32px");
expect(rootElement("root-b").textContent).toContain("第二棵树");
expect(container.querySelector(".watch-canvas-spacer")).not.toBeNull();
expect(container.querySelector(".watch-canvas-layer")).not.toBeNull();
```

Assert that an empty `roots` array still renders only the existing blank-canvas instruction.

**Step 2: Run the test and confirm failure**

Run:

```bash
npx vitest run tests/renderer/watch-multi-root-canvas.test.ts
```

Expected: FAIL because the view reads `config.root` and renders only one `<ul>`.

**Step 3: Render the forest with separate logical and display layers**

Change the markup to this stable structure:

```html
<div class="watch-graph">
  <div class="watch-canvas-spacer" aria-hidden="true"></div>
  <div class="watch-canvas-layer">
    <svg class="watch-connectors" aria-hidden="true"></svg>
    <section class="watch-root-tree" data-watch-root-id="root-a">...</section>
    <section class="watch-root-tree" data-watch-root-id="root-b">...</section>
  </div>
</div>
```

- Pass `roots` and positions from the active workspace into the view state.
- Position each `.watch-root-tree` absolutely in logical pixels.
- Keep `renderWatchNode` unchanged for tree internals and preserve `data-watch-parent-id`.
- Add a root marker such as `data-watch-is-root="true"` to the root node for drag handling.
- Put the SVG and all root trees in the same transformed layer.
- Keep every node rendered regardless of viewport intersection.

CSS requirements:

- `.watch-panel { overflow: auto; }`
- `.watch-graph` is a relative logical-scroll container without `width: max-content` tree assumptions.
- `.watch-canvas-layer` has transform origin `0 0`.
- `.watch-root-tree` is absolute and has no list marker/margin.
- `.watch-canvas-spacer` provides the scaled native scroll extent.

**Step 4: Run the focused test**

Run:

```bash
npx vitest run tests/renderer/watch-multi-root-canvas.test.ts tests/renderer/watch-connector-color.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/features/watch/watch-view.ts src/renderer/styles.css tests/renderer/watch-multi-root-canvas.test.ts
git commit -m "feat: render multi-root watch canvas"
```

### Task 5: Size the canvas and draw connectors correctly at any zoom

**Files:**
- Modify: `src/renderer/features/watch/watch-connectors.ts`
- Modify: `src/renderer/features/watch/watch-controller.ts:render`
- Modify: `tests/renderer/watch-multi-root-canvas.test.ts`
- Modify: `tests/renderer/watch-connector-color.test.ts`

**Step 1: Write failing geometry tests**

Stub root and node bounding boxes, then assert:

- The logical canvas width/height contains every root rectangle plus padding.
- The spacer width/height equals logical extent multiplied by zoom.
- One root produces no connector to another root.
- Internal connectors use logical coordinates after dividing screen-space rectangles by zoom.
- Re-render preserves `scrollLeft` and `scrollTop` within the new maximum bounds.

Expose only a small pure geometry helper if needed, for example:

```ts
export function measureWatchCanvas(
  roots: Array<{ x: number; y: number; width: number; height: number }>,
  padding: number
): { width: number; height: number };
```

Do not create a separate production source file for this helper.

**Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run tests/renderer/watch-multi-root-canvas.test.ts tests/renderer/watch-connector-color.test.ts
```

Expected: FAIL because current connectors use graph `scrollWidth` and raw transformed rectangles.

**Step 3: Implement logical canvas measurement and scaled connectors**

- After rendering, measure every `.watch-root-tree` in screen pixels and convert width/height to logical units using current zoom.
- Set logical dimensions on `.watch-canvas-layer` and scaled dimensions on `.watch-canvas-spacer`.
- Size connector SVG in logical units.
- Convert node bounding rectangles back into layer logical coordinates before constructing paths.
- Preserve connector trend colors and curved path formula.
- Save panel scroll offsets before HTML replacement and restore after size/connectors scheduling.
- Re-run sizing after image/font/layout-affecting changes through the existing animation-frame scheduler; avoid a continuous polling loop.

**Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/renderer/watch-multi-root-canvas.test.ts tests/renderer/watch-connector-color.test.ts tests/renderer/watch-workspace-tabs.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/features/watch/watch-connectors.ts src/renderer/features/watch/watch-controller.ts tests/renderer/watch-multi-root-canvas.test.ts tests/renderer/watch-connector-color.test.ts tests/renderer/watch-workspace-tabs.test.ts
git commit -m "feat: size and connect multi-root watch canvas"
```

### Task 6: Create, delete, edit, and drag roots without breaking node rules

**Files:**
- Modify: `src/renderer/features/watch/watch-controller.ts:handleWatchTreeContextMenu`
- Modify: `src/renderer/features/watch/watch-controller.ts:openNodeDialog`
- Modify: `src/renderer/features/watch/watch-controller.ts:handleNodePointerDown`
- Modify: `src/renderer/features/watch/watch-controller.ts:handleNodePointerMove`
- Modify: `src/renderer/features/watch/watch-controller.ts:handleNodePointerUp`
- Modify: `src/renderer/styles.css`
- Modify: `tests/renderer/watch-node-drag-reparent.test.ts`
- Modify: `tests/renderer/watch-multi-root-canvas.test.ts`

**Step 1: Write failing interaction tests**

Add controller tests for:

```ts
it("creates another root at the blank-canvas logical click position", async () => {
  contextMenu(panel, { clientX: 500, clientY: 360 });
  clickMenu("create-category");
  await saveCategory("新根");
  expect(savedWorkspace.roots.map((root) => root.name)).toEqual(["原根", "新根"]);
  expect(savedWorkspace.rootPositions[newRootId]).toEqual({ x: 480, y: 340 });
});

it("moves a dragged root and descendants together when dropped on blank canvas", async () => {
  dragNode("root-a", { from: [100, 100], to: [420, 300], dropTarget: panel });
  expect(savedWorkspace.rootPositions["root-a"]).toEqual({ x: 344, y: 244 });
  expect(findNode(savedWorkspace.roots, "root-a-stock")).toBeDefined();
});

it("reparents a dragged root tree when dropped on a compatible category", async () => {
  dragNode("root-a", { dropTarget: node("target-category") });
  expect(savedWorkspace.roots.map((root) => root.id)).not.toContain("root-a");
  expect(descendant("target-category", "root-a")).toBe(true);
});

it("does nothing when a regular node is dropped on blank canvas", async () => {
  const before = structuredClone(savedConfig);
  dragNode("nested-category", { dropTarget: panel });
  expect(savedConfig).toEqual(before);
});
```

Also assert:

- A root cannot be dropped onto itself or a descendant.
- A category cannot become sibling to stocks and a stock cannot become sibling to categories.
- Invalid drops do not call save.
- Drag ghost is semi-transparent, follows the pointer, and is removed on success, failure, cancellation, and workspace switch.
- At zoom `2`, a 100-screen-pixel drag changes the persisted logical coordinate by 50.

**Step 2: Run focused tests and confirm failure**

Run:

```bash
npx vitest run tests/renderer/watch-node-drag-reparent.test.ts tests/renderer/watch-multi-root-canvas.test.ts
```

Expected: FAIL because root drag is currently rejected and blank-drop position changes are unsupported.

**Step 3: Implement root-aware interaction**

- Record blank context-menu position as logical canvas coordinates:

```ts
logicalX = (panel.scrollLeft + clientX - panelRect.left) / zoom;
logicalY = (panel.scrollTop + clientY - panelRect.top) / zoom;
```

- On root creation, append rather than overwrite. Resolve obvious overlap by repeatedly adding a fixed logical offset until no existing root bounding box intersects the proposed root origin.
- Keep edit behavior rooted in node ID lookup across all roots.
- Delete root via forest removal so its position is deleted atomically.
- Extend drag state with `isRoot`, start logical position, pointer start, and current zoom snapshot.
- On blank drop, update coordinates only for roots; clamp to `x >= 0`, `y >= 0`.
- On category drop, call the pure forest move operation for both roots and nested nodes.
- Preserve the existing pointer-capture, hand cursor, source opacity, and ghost behavior.

**Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/renderer/watch-node-drag-reparent.test.ts tests/renderer/watch-multi-root-canvas.test.ts tests/shared/watch-tree.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/features/watch/watch-controller.ts src/renderer/styles.css tests/renderer/watch-node-drag-reparent.test.ts tests/renderer/watch-multi-root-canvas.test.ts
git commit -m "feat: support root creation and whole-tree dragging"
```

### Task 7: Add wheel scrolling and cursor-anchored Ctrl-wheel zoom

**Files:**
- Modify: `src/renderer/features/watch/watch-controller.ts`
- Modify: `src/renderer/features/watch/watch-view.ts`
- Modify: `src/renderer/styles.css`
- Create: `tests/renderer/watch-canvas-navigation.test.ts`

**Step 1: Write failing navigation tests**

Test runtime interaction with synthetic wheel events:

```ts
it("uses an ordinary wheel for native vertical scrolling", () => {
  const event = wheel(panel, { deltaY: 120 });
  expect(event.defaultPrevented).toBe(false);
});

it("maps shift-wheel to horizontal scrolling", () => {
  wheel(panel, { shiftKey: true, deltaY: 120 });
  expect(panel.scrollLeft).toBe(120);
});

it("zooms by ten percent and keeps the cursor logical point anchored", () => {
  panel.scrollLeft = 200;
  panel.scrollTop = 100;
  wheel(panel, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 240 });
  expect(canvasLayer.style.transform).toBe("scale(1.1)");
  expect(logicalPointUnderCursor(panel, 300, 240)).toEqual(previousLogicalPoint);
});

it("clamps zoom to 50 and 200 percent", () => {
  repeatZoomOut(20);
  expect(currentScale()).toBe(0.5);
  repeatZoomIn(30);
  expect(currentScale()).toBe(2);
});

it("resets zoom to 100 percent on workspace switch", async () => {
  zoomTo(1.6);
  await switchWorkspace("second");
  expect(currentScale()).toBe(1);
});
```

Also assert blank-canvas pointer panning still changes both scroll axes and that zoom is absent from saved config.

**Step 2: Run the test and confirm failure**

Run:

```bash
npx vitest run tests/renderer/watch-canvas-navigation.test.ts
```

Expected: FAIL because no canvas zoom state or wheel routing exists.

**Step 3: Implement navigation as renderer-only runtime state**

- Store one `watchCanvasZoom` number in the controller, initialized to `1`.
- Reset it to `1` on workspace switch and initial load; do not include it in config save/import/export.
- Handle wheel only when the event originated inside `.watch-panel`:
  - `Ctrl`: prevent default, change by `0.1`, clamp `0.5..2`, update transform/spacer, and adjust scroll offsets to anchor the pointer.
  - `Shift` without Ctrl: prevent default and add the dominant wheel delta to `scrollLeft`.
  - Otherwise: do not prevent default, allowing native vertical scrolling.
- Keep all stock trend points in `renderTrendSparklineSvg`; zoom changes SVG display size through the common transformed layer and must not fetch or synthesize points.
- Recompute connectors after zoom.

Cursor anchor calculation:

```ts
const pointerX = event.clientX - panelRect.left;
const pointerY = event.clientY - panelRect.top;
const logicalX = (panel.scrollLeft + pointerX) / previousZoom;
const logicalY = (panel.scrollTop + pointerY) / previousZoom;
panel.scrollLeft = logicalX * nextZoom - pointerX;
panel.scrollTop = logicalY * nextZoom - pointerY;
```

**Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/renderer/watch-canvas-navigation.test.ts tests/renderer/watch-node-drag-reparent.test.ts tests/renderer/watch-workspace-tabs.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/features/watch/watch-controller.ts src/renderer/features/watch/watch-view.ts src/renderer/styles.css tests/renderer/watch-canvas-navigation.test.ts
git commit -m "feat: add watch canvas scroll and zoom controls"
```

### Task 8: Make market, statistics, and news updates independent of roots' visibility

**Files:**
- Modify: `src/renderer/features/watch/watch-controller.ts:workspaceRoot`
- Modify: `src/renderer/features/watch/watch-controller.ts:updateWorkspaceMarketData`
- Modify: `src/renderer/features/watch/watch-controller.ts:refreshAllWorkspaceMarketData`
- Modify: `src/shared/watch-tree.ts:collectWatchTreeConfigSecids`
- Modify: `tests/renderer/watch-workspace-tabs.test.ts`
- Modify: `tests/renderer/watch-refresh-interval.test.ts`
- Modify: `tests/renderer/watch-multi-root-canvas.test.ts`

**Step 1: Write failing background-update tests**

Cover these cases:

```ts
it("requests stocks from every root in an active workspace", async () => {
  await refreshActiveWorkspace();
  expect(provider.requestedSecids).toEqual(expect.arrayContaining([
    "1.600000",
    "0.000001"
  ]));
});

it("updates inactive workspaces without switching or clearing their state", async () => {
  await switchWorkspace("second");
  await periodicRefresh();
  await switchWorkspace("first");
  expect(firstWorkspaceStock("1.600000").textContent).toContain("+2.00%");
  expect(loadCallCountFor("1.600000")).toBeGreaterThan(0);
});

it("refreshes stocks in collapsed and offscreen roots", async () => {
  collapse("offscreen-category");
  scrollAwayFrom("offscreen-root");
  await periodicRefresh();
  expect(provider.requestedSecids).toContain("1.688777");
});
```

Do not emulate `IntersectionObserver`; the assertion should prove provider input comes from config data.

**Step 2: Run focused tests and confirm failure**

Run:

```bash
npx vitest run tests/renderer/watch-workspace-tabs.test.ts tests/renderer/watch-refresh-interval.test.ts tests/renderer/watch-multi-root-canvas.test.ts
```

Expected: FAIL where the controller still calls `collectStockSecids(workspace.root)`.

**Step 3: Switch controller traversal to workspace forests**

- Replace `workspaceRoot` with `workspaceRoots`.
- Build each refresh secid list from every configured root, not from rendered nodes.
- Preserve one market-state map per workspace and merge valid same-date snapshots as before.
- Keep inactive-workspace refresh scheduling unchanged and never clear a workspace's market state merely because the user switched away.
- Ensure category averages, counts, strength, connector colors, sudden-move indicators, and news badges consume the same latest in-memory maps when that workspace is rendered again.

**Step 4: Run the watch feature suite**

Run:

```bash
npx vitest run tests/shared/watch-tree.test.ts tests/renderer/watch-workspace-tabs.test.ts tests/renderer/watch-refresh-interval.test.ts tests/renderer/watch-multi-root-canvas.test.ts tests/renderer/watch-node-drag-reparent.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/features/watch/watch-controller.ts src/shared/watch-tree.ts tests/renderer/watch-workspace-tabs.test.ts tests/renderer/watch-refresh-interval.test.ts tests/renderer/watch-multi-root-canvas.test.ts
git commit -m "fix: refresh all watch roots independent of viewport"
```

### Task 9: Update architecture documentation and run full verification

**Files:**
- Modify: `docs/architecture.md`
- Review: `docs/plans/2026-08-10-watch-multi-root-canvas-design.md`
- Review: all files changed by Tasks 1-8

**Step 1: Update the permanent architecture document**

Document in `docs/architecture.md`:

- Canonical `WatchTreeWorkspace.roots` and `rootPositions` schema.
- Legacy migration boundary and canonical save/export format.
- Shared forest traversal/mutation API ownership.
- Renderer structure: scroll panel, spacer, transformed logical layer, root containers, connector SVG.
- Controller ownership of non-persisted zoom and scroll runtime state.
- Root creation/drag/reparent invariants.
- Market/news/stat refresh independence from viewport, collapse state, and active workspace.
- Zoom limits, wheel bindings, and full one-minute-point sparkline behavior.

Do not copy the implementation checklist into the architecture document.

**Step 2: Run formatting and static checks**

Run:

```bash
git diff --check
npm run typecheck
```

Expected: both exit 0.

**Step 3: Run all automated tests**

Run:

```bash
npm test
```

Expected: all Vitest test files and tests pass.

**Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: TypeScript node build and Vite renderer build exit 0.

**Step 5: Review the implementation before claiming completion**

Use `@superpowers:requesting-code-review`, then inspect:

```bash
git status --short
git diff --stat HEAD~8..HEAD
git diff HEAD~8..HEAD -- src/shared/types.ts src/shared/watch-tree.ts src/renderer/features/watch
```

Address findings with focused tests. Re-run `git diff --check`, `npm run typecheck`, `npm test`, and `npm run build` after any fix.

**Step 6: Commit documentation and final fixes**

```bash
git add docs/architecture.md docs/plans/2026-08-10-watch-multi-root-canvas-design.md src tests
git commit -m "docs: document multi-root watch canvas architecture"
```

Skip the commit only if there are genuinely no uncommitted changes.

**Step 7: Push the branch**

```bash
git push origin feature/a-share-research-desktop
```

Expected: remote branch advances to the verified commit.

**Step 8: Build and deploy the Windows unpacked application**

First check whether `A股调研助手.exe` is running. If it is running, stop and notify the user so they can close it; do not kill it.

After the user confirms closure, run:

```bash
npm run dist:win
npm run deploy:win-unpacked
```

`dist:win` may produce the unpacked application and then fail at the NSIS installer stage if Wine is unavailable. In that specific case, verify the unpacked output exists and continue with `deploy:win-unpacked`; report the installer limitation accurately.

Verify the deployed package contains the current application archive and do not launch it. Notify the user that deployment is complete so they can open and test it themselves.
