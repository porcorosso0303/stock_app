# Modular Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the desktop app into independent app shell, research, and watch modules while introducing provider interfaces for future market data sources and research AI providers.

**Architecture:** Keep behavior stable while moving responsibilities into feature-specific files. Main process gets separate IPC registration modules and provider interfaces; renderer gets feature controllers and views. Provider extraction happens before adding any new external data source or model.

**Tech Stack:** Electron, TypeScript, Vite, Vitest, Node fs/path APIs, existing IPC/preload bridge.

---

### Task 1: Split Main IPC By Module

**Files:**
- Create: `src/main/app-ipc.ts`
- Create: `src/main/modules/research/research-ipc.ts`
- Create: `src/main/modules/watch/watch-ipc.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/ipc.test.ts`

**Step 1: Write failing module-boundary test**

Add a test that reads `src/main/ipc.ts` and expects it to delegate to module registration instead of containing feature handlers directly:

```ts
expect(source).toContain("registerAppIpc");
expect(source).toContain("registerResearchIpc");
expect(source).toContain("registerWatchIpc");
expect(source).not.toContain("IPC.startResearch");
expect(source).not.toContain("IPC.saveWatchTree");
```

**Step 2: Run test**

Run: `npm test -- tests/main/ipc.test.ts`

Expected: FAIL because `src/main/ipc.ts` still contains all handlers.

**Step 3: Move handlers**

Move:

- bootstrap/config/codex detection to `app-ipc.ts`
- research spec/history/research task/PDF handlers to `modules/research/research-ipc.ts`
- watch tree/market/search handlers to `modules/watch/watch-ipc.ts`

Keep `registerIpcHandlers` as orchestration only.

**Step 4: Run tests**

Run:

```bash
npm test -- tests/main/ipc.test.ts
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/ipc.ts src/main/app-ipc.ts src/main/modules/research/research-ipc.ts src/main/modules/watch/watch-ipc.ts tests/main/ipc.test.ts
git commit -m "refactor: split main ipc modules"
```

### Task 2: Extract Watch Market Provider Interface

**Files:**
- Create: `src/main/modules/watch/market-data/market-data-provider.ts`
- Create: `src/main/modules/watch/market-data/east-money-provider.ts`
- Modify: `src/main/east-money-quote-service.ts`
- Modify: `src/main/watch-market-service.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/watch-market-service.test.ts`
- Test: `tests/main/east-money-quote-service.test.ts`

**Step 1: Write failing interface test**

Add a test in `watch-market-service.test.ts` proving `WatchMarketService` accepts a provider with:

```ts
listQuotes(secids)
listTrends(secids)
searchStocks(query)
```

Expected: FAIL because current interface expects `list` and `trends`.

**Step 2: Add provider interface**

Create:

```ts
export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  listQuotes(secids: string[]): Promise<StockQuote[]>;
  listTrends(secids: string[]): Promise<StockTrend[]>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
}
```

**Step 3: Adapt EastMoney provider**

Rename public methods through a wrapper or class rename:

- `list` -> `listQuotes`
- `trends` -> `listTrends`
- `search` -> `searchStocks`

Keep compatibility exports if needed to reduce churn.

**Step 4: Update service**

`WatchMarketService` depends on `MarketDataProvider`.

**Step 5: Run tests**

Run:

```bash
npm test -- tests/main/watch-market-service.test.ts tests/main/east-money-quote-service.test.ts
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/main/modules/watch/market-data src/main/east-money-quote-service.ts src/main/watch-market-service.ts src/main/index.ts tests/main/watch-market-service.test.ts tests/main/east-money-quote-service.test.ts
git commit -m "refactor: add watch market data provider"
```

### Task 3: Extract Research Provider Interface

**Files:**
- Create: `src/main/modules/research/providers/research-provider.ts`
- Create: `src/main/modules/research/providers/codex-cli-provider.ts`
- Modify: `src/main/research-service.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/research-service.test.ts`

**Step 1: Write failing provider test**

Add a fake provider in `research-service.test.ts` and assert `ResearchService` can run through that provider without directly constructing `CodexRunner`.

Expected: FAIL because `ResearchService` currently creates runner internally through `createRunner`.

**Step 2: Add interface**

```ts
export interface ResearchProvider {
  readonly id: string;
  readonly label: string;
  detect(): Promise<CodexEnvironmentStatus>;
  run(request: ResearchProviderRequest): Promise<ResearchProviderResult>;
  cancel(): void;
}
```

**Step 3: Move Codex CLI details**

Move Codex-specific launcher detection, runner creation, prompt building, and skill preparation into `CodexCliResearchProvider`.

**Step 4: Simplify service**

`ResearchService` validates stock name, creates history/run paths, calls provider, writes report/PDF, updates history.

**Step 5: Run tests**

Run:

```bash
npm test -- tests/main/research-service.test.ts
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/main/research-service.ts src/main/modules/research/providers src/main/index.ts tests/main/research-service.test.ts
git commit -m "refactor: add research provider interface"
```

### Task 4: Split Renderer Shell And Research Feature

**Files:**
- Create: `src/renderer/app/dom.ts`
- Create: `src/renderer/app/shell-controller.ts`
- Create: `src/renderer/features/research/research-controller.ts`
- Modify: `src/renderer/main.ts`
- Test: `tests/renderer/view-model.test.ts`
- Test: `tests/renderer/module-boundary.test.ts`

**Step 1: Write failing source-boundary test**

Create `tests/renderer/module-boundary.test.ts`:

```ts
expect(await readFile("src/renderer/main.ts", "utf8")).toContain("createShellController");
expect(source).not.toContain("async function handlePrimaryAction");
```

**Step 2: Extract DOM lookup**

Move `getElement` and the `elements` object into `app/dom.ts`.

**Step 3: Extract shell**

Move feature switching and tab switching to `shell-controller.ts`.

**Step 4: Extract research**

Move research state, history rendering, report reading, task start/cancel, PDF open/retry, research spec saving/resetting to `research-controller.ts`.

**Step 5: Run tests**

Run:

```bash
npm test -- tests/renderer/module-boundary.test.ts tests/renderer/view-model.test.ts
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/renderer/main.ts src/renderer/app src/renderer/features/research tests/renderer/module-boundary.test.ts
git commit -m "refactor: split renderer shell and research"
```

### Task 5: Split Renderer Watch Feature

**Files:**
- Create: `src/renderer/features/watch/watch-controller.ts`
- Create: `src/renderer/features/watch/watch-view.ts`
- Create: `src/renderer/features/watch/watch-context-menu.ts`
- Create: `src/renderer/features/watch/watch-connectors.ts`
- Modify: `src/renderer/main.ts`
- Test: `tests/renderer/watch-empty-context-menu.test.ts`
- Test: `tests/renderer/watch-startup-persistence.test.ts`

**Step 1: Write failing source-boundary test**

Extend `tests/renderer/module-boundary.test.ts`:

```ts
expect(source).not.toContain("renderWatchTree");
expect(source).not.toContain("drawWatchConnectors");
```

**Step 2: Extract watch view**

Move HTML rendering functions and `formatChangePercent` into `watch-view.ts`.

**Step 3: Extract context menu**

Move node and blank-panel context menu handling into `watch-context-menu.ts`.

**Step 4: Extract connectors**

Move connector drawing into `watch-connectors.ts`.

**Step 5: Extract watch controller**

Move watch state, load/save tree, market data load/refresh, polling, collapse/pan behavior into `watch-controller.ts`.

**Step 6: Run tests**

Run:

```bash
npm test -- tests/renderer/watch-empty-context-menu.test.ts tests/renderer/watch-startup-persistence.test.ts tests/renderer/module-boundary.test.ts
npm run build
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/renderer/main.ts src/renderer/features/watch tests/renderer/module-boundary.test.ts
git commit -m "refactor: split renderer watch feature"
```

### Task 6: Add Provider Selection Fields Without UI

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`
- Test: `tests/main/config-store.test.ts`

**Step 1: Write failing config test**

Add a test that writes and reads:

```ts
{
  watchMarketProviderId: "east-money",
  researchProviderId: "codex-cli"
}
```

Expected: FAIL if config typing or validation does not preserve fields.

**Step 2: Add config fields**

Extend `AppConfig` with optional provider IDs. Do not add UI yet.

**Step 3: Run tests**

Run:

```bash
npm test -- tests/main/config-store.test.ts
npm run build
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/shared/types.ts src/main/config-store.ts tests/main/config-store.test.ts
git commit -m "refactor: reserve provider config fields"
```

### Task 7: Final Verification And Windows Test Deploy

**Files:**
- No source files unless verification reveals a bug.

**Step 1: Run full verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all pass.

**Step 2: Build Windows unpacked**

Run:

```bash
npm run dist:win
```

Expected: `release/win-unpacked` refreshes. NSIS may fail on Linux/WSL without Wine.

**Step 3: Deploy without deleting user data**

If the app is running, ask the user to close it. Do not kill it yourself.

Run:

```bash
npm run deploy:win-unpacked
```

Expected: sync succeeds and `win-unpacked/user_data` remains.

**Step 4: Commit any final doc updates**

```bash
git status --short
```

Expected: clean.
