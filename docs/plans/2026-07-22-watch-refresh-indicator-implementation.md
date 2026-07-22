# Watch Refresh Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show market refresh activity in a fixed top-toolbar indicator without shifting the watch-tree canvas.

**Architecture:** Add a dedicated renderer element for transient market refresh state and keep general watch status in the same fixed-height heading row. Toggle the indicator only in the two guarded market-update entry points so success and failure share cleanup through `finally`.

**Tech Stack:** TypeScript, Electron renderer DOM/CSS, Vitest.

---

### Task 1: Define the fixed toolbar indicator

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/app/dom.ts`
- Test: `tests/renderer/watch-refresh-indicator.test.ts`

1. Write a failing source-structure test for the fixed heading row, hidden hourglass indicator and DOM binding.
2. Run the focused test and confirm the elements are missing.
3. Add the heading row, indicator and non-expanding CSS.
4. Re-run the test and typecheck.

### Task 2: Separate market loading state from general status

**Files:**
- Modify: `src/renderer/features/watch/watch-controller.ts`
- Test: `tests/renderer/watch-refresh-indicator.test.ts`

1. Add failing assertions that market update entry points toggle the dedicated indicator in `try/finally` and no longer assign loading messages to `watchStatus`.
2. Run the focused test and confirm it fails.
3. Remove market loading-message parameters and toggle `watchRefreshIndicator.hidden` at guarded update boundaries.
4. Re-run focused tests and typecheck.

### Task 3: Document, verify and deploy

**Files:**
- Modify: `docs/architecture.md`

1. Document the fixed status row and dedicated market refresh indicator.
2. Run `npm test`, `npm run build`, and `git diff --check`.
3. Commit and push changes.
4. Check the Windows application process without terminating it; when closed, package and deploy `win-unpacked`.
5. Compare built and deployed `app.asar` files.

