# 盯盘脑图走势与本地缓存 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在盯盘脑图股票节点旁显示当日走势曲线和涨跌幅，并将脑图、走势缓存和调研运行数据统一保存到软件根目录 `user_data/`。

**Architecture:** 主进程负责解析应用根目录、维护 `user_data/`、拉取和缓存行情走势；Renderer 只通过 IPC 获取缓存感知的盯盘行情数据并渲染 SVG。共享层放置趋势数据类型、缓存合并和 SVG 数据计算，便于 Vitest 覆盖。

**Tech Stack:** Electron、TypeScript、Vitest、Node.js `fs/promises`、现有东财公开行情接口、原生 SVG。

---

## Task 1: 将业务数据目录切换到软件根目录 `user_data/`

**Files:**
- Create: `src/main/app-data-directory.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/app-data-directory.test.ts`

**Step 1: Write the failing test**

Create `tests/main/app-data-directory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolveAppDataDirectory } from "../../src/main/app-data-directory";

describe("resolveAppDataDirectory", () => {
  it("uses the project root in development", () => {
    expect(resolveAppDataDirectory({
      isPackaged: false,
      appPath: "/repo",
      executablePath: "/repo/node_modules/electron/dist/electron"
    })).toBe(join("/repo", "user_data"));
  });

  it("uses the executable directory when packaged", () => {
    expect(resolveAppDataDirectory({
      isPackaged: true,
      appPath: "C:\\Program Files\\A股调研助手\\resources\\app.asar",
      executablePath: "C:\\Apps\\A股调研助手\\A股调研助手.exe"
    })).toBe(join("C:\\Apps\\A股调研助手", "user_data"));
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/main/app-data-directory.test.ts
```

Expected: FAIL because `src/main/app-data-directory.ts` does not exist.

**Step 3: Write minimal implementation**

Create `src/main/app-data-directory.ts`:

```ts
import { dirname, join } from "node:path";

export interface AppDataDirectoryOptions {
  isPackaged: boolean;
  appPath: string;
  executablePath: string;
}

export function resolveAppDataDirectory(options: AppDataDirectoryOptions): string {
  const root = options.isPackaged
    ? dirname(options.executablePath)
    : options.appPath;
  return join(root, "user_data");
}
```

Modify `src/main/index.ts` to replace `app.getPath("userData")` with:

```ts
const userData = resolveAppDataDirectory({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  executablePath: process.execPath
});
```

**Step 4: Run test**

Run:

```bash
npx vitest run tests/main/app-data-directory.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/app-data-directory.ts src/main/index.ts tests/main/app-data-directory.test.ts
git commit -m "feat: store app data under local user_data"
```

## Task 2: Add trend types, cache store, and merge helpers

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/watch-tree.ts`
- Create: `src/main/watch-market-cache-store.ts`
- Test: `tests/shared/watch-tree.test.ts`
- Test: `tests/main/watch-market-cache-store.test.ts`

**Step 1: Write failing shared tests**

Append tests in `tests/shared/watch-tree.test.ts`:

```ts
import { mergeQuoteIntoTrend, normalizeTrendSegments } from "../../src/shared/watch-tree";

it("merges the latest quote into a trend without duplicating fetchedAt", () => {
  const trend = {
    secid: "1.600519",
    fetchedAt: "2026-06-04T01:30:00.000Z",
    points: [{ time: "09:30", changePercent: -0.5 }]
  };

  expect(mergeQuoteIntoTrend(trend, {
    secid: "1.600519",
    fetchedAt: "2026-06-04T01:31:00.000Z",
    changePercent: 1.2
  })).toEqual({
    secid: "1.600519",
    fetchedAt: "2026-06-04T01:31:00.000Z",
    points: [
      { time: "09:30", changePercent: -0.5 },
      { time: "01:31", changePercent: 1.2 }
    ]
  });
});

it("normalizes positive and negative trend segments around the zero axis", () => {
  const segments = normalizeTrendSegments([
    { time: "09:30", changePercent: -1 },
    { time: "10:00", changePercent: 0.5 },
    { time: "10:30", changePercent: 1 }
  ], 120, 40);

  expect(segments.some((segment) => segment.kind === "negative")).toBe(true);
  expect(segments.some((segment) => segment.kind === "positive")).toBe(true);
  expect(segments.every((segment) => segment.path.startsWith("M "))).toBe(true);
});
```

Create `tests/main/watch-market-cache-store.test.ts` covering same-day hit and stale-day miss.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/shared/watch-tree.test.ts tests/main/watch-market-cache-store.test.ts
```

Expected: FAIL because helpers and store do not exist.

**Step 3: Write minimal implementation**

Add types to `src/shared/types.ts`:

```ts
export interface StockTrendPoint {
  time: string;
  changePercent: number;
}

export interface StockTrend {
  secid: string;
  points: StockTrendPoint[];
  fetchedAt: string;
  errorMessage?: string;
}

export interface WatchMarketData {
  quotes: StockQuote[];
  trends: StockTrend[];
  updatedAt: string;
  fromCache: boolean;
}

export interface WatchMarketCache {
  tradingDate: string;
  quotes: StockQuote[];
  trends: StockTrend[];
  updatedAt: string;
}
```

Add helper functions to `src/shared/watch-tree.ts`:

- `mergeQuoteIntoTrend(trend, quote)` appends latest `changePercent` using HH:mm from `quote.fetchedAt`, replacing an existing point with the same time.
- `normalizeTrendSegments(points, width, height)` returns colored SVG path segments for positive and negative points around a center zero axis.

Create `WatchMarketCacheStore` backed by `JsonStore<WatchMarketCache | undefined>`:

- `getForDate(date): Promise<WatchMarketCache | undefined>`
- `write(cache): Promise<void>`
- Validate stale date by returning `undefined`.

**Step 4: Run tests**

Run:

```bash
npx vitest run tests/shared/watch-tree.test.ts tests/main/watch-market-cache-store.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/watch-tree.ts src/main/watch-market-cache-store.ts tests/shared/watch-tree.test.ts tests/main/watch-market-cache-store.test.ts
git commit -m "feat: add watch market cache helpers"
```

## Task 3: Add EastMoney trend fetching and cache-aware market service

**Files:**
- Modify: `src/main/east-money-quote-service.ts`
- Create: `src/main/watch-market-service.ts`
- Test: `tests/main/east-money-quote-service.test.ts`
- Test: `tests/main/watch-market-service.test.ts`

**Step 1: Write failing tests**

Extend `tests/main/east-money-quote-service.test.ts` to verify `trends(["1.600519"])` parses a mocked EastMoney trend response into `StockTrend`.

Create `tests/main/watch-market-service.test.ts`:

- same-day cache returns cached data and does not call quote service.
- stale cache calls quote and trend services and writes a new cache.
- refresh merges latest quote into existing trend and writes cache.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/main/east-money-quote-service.test.ts tests/main/watch-market-service.test.ts
```

Expected: FAIL because trend and market service APIs do not exist.

**Step 3: Write minimal implementation**

Modify `EastMoneyQuoteService`:

- Add `trends(secids: string[]): Promise<StockTrend[]>`.
- Use EastMoney intraday trend endpoint and parse point strings defensively.
- On per-stock failure return `{ secid, fetchedAt, points: [], errorMessage }`.

Create `WatchMarketService`:

```ts
get(secids: string[]): Promise<WatchMarketData>
refresh(secids: string[]): Promise<WatchMarketData>
```

`get()` returns same-day cache if present. Otherwise fetches quotes and trends, writes cache, returns `fromCache: false`.

`refresh()` always fetches latest quotes, reuses existing same-day trends, merges quote points, writes cache.

**Step 4: Run tests**

Run:

```bash
npx vitest run tests/main/east-money-quote-service.test.ts tests/main/watch-market-service.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/east-money-quote-service.ts src/main/watch-market-service.ts tests/main/east-money-quote-service.test.ts tests/main/watch-market-service.test.ts
git commit -m "feat: cache watch trends and quotes"
```

## Task 4: Wire market data through IPC and preload

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/ipc.test.ts`
- Test: `tests/preload/preload-sandbox.test.ts`

**Step 1: Write failing tests**

Update `tests/main/ipc.test.ts`:

- `IPC.getWatchMarketData` validates `secids` array and calls `watchMarketService.get`.
- `IPC.refreshWatchMarketData` validates `secids` array and calls `watchMarketService.refresh`.
- invalid `secids` rejects and service is not called.

Update preload sandbox test if it checks the literal IPC map.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/main/ipc.test.ts tests/preload/preload-sandbox.test.ts
```

Expected: FAIL because IPC channels and API methods do not exist.

**Step 3: Write minimal implementation**

Add IPC channels:

- `watch-market:get`
- `watch-market:refresh`

Add `StockResearchApi` methods:

- `getWatchMarketData(secids)`
- `refreshWatchMarketData(secids)`

Register handlers in `src/main/ipc.ts` and construct `WatchMarketService` in `src/main/index.ts` using `WatchMarketCacheStore(join(userData, "watch-quotes-cache.json"))`.

**Step 4: Run tests**

Run:

```bash
npx vitest run tests/main/ipc.test.ts tests/preload/preload-sandbox.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts tests/main/ipc.test.ts tests/preload/preload-sandbox.test.ts
git commit -m "feat: expose cached watch market data IPC"
```

## Task 5: Render sparklines and percentage labels in the watch tree

**Files:**
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer/view-model.test.ts` or create `tests/shared/watch-tree.test.ts` assertions for render helpers if extracted

**Step 1: Write failing test**

Prefer extracting pure helpers from Renderer if needed:

- `renderWatchSparkline(trend)` returns SVG containing `.watch-trend-zero-axis`.
- Positive segment uses `watch-trend-positive`.
- Negative segment uses `watch-trend-negative`.
- `formatTrendPercent(1.23)` returns `+1.23%` with positive class.

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/renderer/view-model.test.ts tests/shared/watch-tree.test.ts
```

Expected: FAIL because rendering helpers/classes are absent.

**Step 3: Write minimal implementation**

In `src/renderer/main.ts`:

- Add `watchTrends = new Map<string, StockTrend>()`.
- Update initial watch load to call `api.getWatchMarketData(secids)`.
- Update refresh button and timer to call `api.refreshWatchMarketData(secids)`.
- Render stock nodes as name, SVG sparkline, and percentage label.

In `src/renderer/styles.css`:

- Make stock nodes wider only as needed.
- Add red/green/gray styles for trend line and percentage label.
- Add dashed zero axis.

**Step 4: Run tests**

Run:

```bash
npx vitest run tests/renderer/view-model.test.ts tests/shared/watch-tree.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/main.ts src/renderer/styles.css tests/renderer/view-model.test.ts tests/shared/watch-tree.test.ts
git commit -m "feat: show watch stock trend sparklines"
```

## Task 6: Update product docs and Windows acceptance checklist

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-06-02-watch-mind-map-design.md`
- Modify: `docs/windows-acceptance.md`

**Step 1: Update docs**

Document:

- `user_data/` replaces Electron user data directory for business files.
- `watch-quotes-cache.json` stores same-day quotes and trends.
- Stock nodes display sparkline plus right-side percentage.
- Same-day restart uses cached trends; next-day restart refreshes.

**Step 2: Check docs diff**

Run:

```bash
git diff -- README.md docs/plans/2026-06-02-watch-mind-map-design.md docs/windows-acceptance.md
```

Expected: Diff only covers the new behavior.

**Step 3: Commit**

```bash
git add README.md docs/plans/2026-06-02-watch-mind-map-design.md docs/windows-acceptance.md
git commit -m "docs: document watch trend cache behavior"
```

## Task 7: Full verification and Windows test build deployment

**Files:**
- No source edits expected.

**Step 1: Run automated verification**

Run:

```bash
npm test
npm run build
git diff --check
git status --short
```

Expected: PASS, no whitespace errors, clean status except intentional unpushed commits.

**Step 2: Build Windows app**

Run:

```bash
npm run dist:win
```

Expected: `release/` contains Windows build artifacts.

**Step 3: Deploy Windows test build**

Run on the WSL/Windows host:

```bash
mkdir -p "/mnt/c/Users/pangwa936/Desktop/A股调研助手-最新版本"
rsync -a --delete release/win-unpacked/ "/mnt/c/Users/pangwa936/Desktop/A股调研助手-最新版本/win-unpacked/"
find release -maxdepth 1 -name "*.exe" -type f -exec cp {} "/mnt/c/Users/pangwa936/Desktop/A股调研助手-最新版本/" \;
"/mnt/c/Users/pangwa936/Desktop/A股调研助手-最新版本/win-unpacked/A股调研助手.exe"
```

Expected: Latest app launches for user testing.
