# Watch Stock Holding Marker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persistent “持仓股” property to stock nodes and render holding stock names with an unmistakable purple highlight.

**Architecture:** Extend the existing `WatchTreeStockNode` configuration instead of introducing another store. Reuse the current watch node dialog, controller save path, tree validator, renderer, and CSS responsibilities; import/export automatically includes the field because it already transfers the validated watch tree.

**Tech Stack:** TypeScript, Electron, HTML/CSS, Vitest

---

### Task 1: Persist and validate the holding property

**Files:**
- Modify: `tests/shared/watch-tree.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/watch-tree.ts`

**Step 1: Write the failing validator tests**

Add cases that validate these behaviors:

```ts
expect(validateWatchTreeConfig(treeWith({ isHolding: true })))
  .toMatchObject({ root: { children: [{ isHolding: true }] } });

expect(validateWatchTreeConfig(treeWith({ isHolding: false })))
  .toEqual(treeWith({}));

expect(() => validateWatchTreeConfig(treeWith({ isHolding: "yes" })))
  .toThrow("持仓股");
```

Use the existing stock-node fixtures and assertions in `tests/shared/watch-tree.test.ts` rather than adding production-only test helpers.

**Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/shared/watch-tree.test.ts`

Expected: FAIL because `isHolding` is not defined or preserved, and invalid values are not rejected.

**Step 3: Implement the minimal data model**

In `src/shared/types.ts`:

```ts
export interface WatchTreeStockNode {
  id: string;
  type: "stock";
  name: string;
  secid: string;
  industryPosition?: WatchIndustryPosition;
  isHolding?: boolean;
}
```

In `src/shared/watch-tree.ts`, validate the raw field:

```ts
function validateIsHolding(value: unknown): boolean | undefined {
  if (value === undefined || value === false) {
    return undefined;
  }
  if (value === true) {
    return true;
  }
  throw new Error("股票持仓股属性必须是布尔值");
}
```

Call this validator in the stock branch and only spread `{ isHolding: true }` when set.

**Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/shared/watch-tree.test.ts`

Expected: PASS.

### Task 2: Add holding controls to the stock editor

**Files:**
- Modify: `tests/renderer/watch-stock-industry-position.test.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app/dom.ts`
- Modify: `src/renderer/features/watch/watch-controller.ts`

**Step 1: Write the failing editor wiring test**

Extend the existing stock-property editor test to require:

```ts
expect(html).toContain('id="watch-node-holding"');
expect(html).toContain("持仓股");
expect(dom).toContain('watchNodeHolding: getElement<HTMLSelectElement>("watch-node-holding")');
expect(controller).toContain('existing?.type === "stock" && existing.isHolding ? "true" : "false"');
expect(controller).toContain('isHolding: true');
```

Also assert that the label and select participate in the existing stock-only visibility logic.

**Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/renderer/watch-stock-industry-position.test.ts`

Expected: FAIL because the holding control and controller wiring do not exist.

**Step 3: Implement the editor control and mapping**

Add to `src/renderer/index.html` near “行业地位”:

```html
<label id="watch-node-holding-label" for="watch-node-holding">持仓股</label>
<select id="watch-node-holding">
  <option value="false">否</option>
  <option value="true">是</option>
</select>
```

Add typed references in `src/renderer/app/dom.ts`.

In `openNodeDialog`, set:

```ts
elements.watchNodeHolding.value = existing?.type === "stock" && existing.isHolding
  ? "true"
  : "false";
```

In `syncSecidVisibility`, hide/show the new label and select with the other stock-only controls.

When constructing a stock node in `saveNode`, add only the true value:

```ts
...(elements.watchNodeHolding.value === "true" ? { isHolding: true } : {})
```

**Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/renderer/watch-stock-industry-position.test.ts`

Expected: PASS.

### Task 3: Highlight holding stock names

**Files:**
- Create: `tests/renderer/watch-stock-holding.test.ts`
- Modify: `src/renderer/features/watch/watch-view.ts`
- Modify: `src/renderer/styles.css`

**Step 1: Write failing rendering tests**

Render one tree with `isHolding: true` and one without the property using `renderWatchTree`. Assert:

```ts
expect(holdingContainer.innerHTML).toContain('class="watch-stock-name is-holding"');
expect(normalContainer.innerHTML).toContain('class="watch-stock-name"');
expect(normalContainer.innerHTML).not.toContain('watch-stock-name is-holding');
```

Read the CSS and assert that `.watch-stock-name.is-holding strong` exists so the semantic class has a visual definition.

**Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/renderer/watch-stock-holding.test.ts`

Expected: FAIL because no holding class or style exists.

**Step 3: Implement the semantic class and visual style**

In `watch-view.ts`, render:

```ts
<span class="watch-stock-name${node.isHolding ? " is-holding" : ""}">
```

In `styles.css`, add a high-contrast purple treatment scoped to the name text:

```css
.watch-stock-name.is-holding strong {
  color: #c51ce0;
  font-weight: 900;
  text-shadow: 0 0 2px #fff, 0 0 7px #d83bea99;
}
```

Do not alter quote colors, sparkline colors, card backgrounds, or sudden-move arrow styles.

**Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/renderer/watch-stock-holding.test.ts`

Expected: PASS.

### Task 4: Synchronize architecture documentation and verify

**Files:**
- Modify: `docs/architecture.md`

**Step 1: Update the canonical architecture document**

Document:

- `WatchTreeStockNode.isHolding?: boolean` and its persistence semantics.
- The stock editor’s “持仓股” control.
- The renderer’s `is-holding` class and purple highlighted name behavior.
- Import/export preservation through the existing validated watch tree transfer.

Keep implementation planning details in this plan file, not in `docs/architecture.md`.

**Step 2: Run fresh complete verification**

Run:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands exit 0 with no test failures.

**Step 3: Package and deploy the Windows unpacked build**

Run: `npm run dist:win`

Expected in the current WSL environment: `release/win-unpacked` is generated before the known NSIS/Wine failure.

Check whether `A股调研助手.exe` is running. If it is, ask the user to close it; do not terminate it. Then run:

```bash
npm run deploy:win-unpacked
```

Expected: deployment to the configured Windows desktop target succeeds.

**Step 4: Commit the implementation and documentation**

Review the dirty worktree carefully and stage only intended changes, preserving all pre-existing user work. Commit with an accurate message after verification.
