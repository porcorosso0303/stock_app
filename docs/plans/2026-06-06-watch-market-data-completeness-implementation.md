# Watch Market Data Completeness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure watch mind-map sparklines are drawn only from complete, reliable intraday data tagged by real trading date.

**Architecture:** Providers parse source-specific fields and return standardized trend data with `tradingDate`. Shared provider-independent formulas live in `data-calc-helper.ts`. `WatchMarketService` handles cache selection, completeness checks, refresh cadence semantics, and never calculates trend change percent from quotes.

**Tech Stack:** TypeScript, Electron main/renderer, Vitest, existing JSON user data stores.

---

### Task 1: Add Trading Date to Shared Types

**Files:**
- Modify: `src/shared/types.ts`
- Test: `tests/main/watch-market-cache-store.test.ts`
- Test: `tests/main/watch-market-service.test.ts`

**Steps:**

1. Add `tradingDate: string` to `StockTrend`.
2. Add `tradingDate: string` to `WatchMarketData`.
3. Update test fixtures that build `StockTrend`.
4. Run: `npm test -- tests/main/watch-market-cache-store.test.ts tests/main/watch-market-service.test.ts`

Expected: tests compile and pass after fixtures are updated.

### Task 2: Create Data Calc Helper

**Files:**
- Create: `src/main/modules/watch/market-data/data-calc-helper.ts`
- Test: `tests/main/data-calc-helper.test.ts`

**Steps:**

1. Write failing tests for:
   - `calculateChangePercent(105, 100) === 5`
   - invalid previous close returns `undefined`.
   - `normalizeIntradayTrendPoints` fills `changePercent` for price points.
2. Implement helper functions.
3. Run: `npm test -- tests/main/data-calc-helper.test.ts`

Expected: helper tests pass.

### Task 3: Standardize EastMoney Trend Data in Provider Layer

**Files:**
- Modify: `src/main/east-money-quote-service.ts`
- Test: `tests/main/east-money-quote-service.test.ts`

**Steps:**

1. Write failing tests that `listTrends()` returns `tradingDate` parsed from trend rows.
2. Write failing tests that missing `prePrice` returns a trend with `errorMessage` instead of zeroed change percent.
3. Update EastMoney parsing to:
   - parse `tradingDate` from trend row date.
   - parse `previousClose` from `prePrice`.
   - call `data-calc-helper` to fill `changePercent`.
   - return sorted points.
4. Run: `npm test -- tests/main/east-money-quote-service.test.ts`

Expected: provider returns standardized `StockTrend`.

### Task 4: Remove WatchMarketService Quote-Based Trend Normalization

**Files:**
- Modify: `src/main/watch-market-service.ts`
- Test: `tests/main/watch-market-service.test.ts`

**Steps:**

1. Write or update tests proving `WatchMarketService` does not recalculate trend point `changePercent` from quotes.
2. Delete `normalizeTrendChangePercents()` and `derivePreviousClose()` usage.
3. Keep quote fallback only for display quote when quote endpoint fails and trend has a latest point.
4. Run: `npm test -- tests/main/watch-market-service.test.ts`

Expected: trends remain provider-standardized.

### Task 5: Cache by Provider Trading Date

**Files:**
- Modify: `src/main/watch-market-service.ts`
- Modify: `src/main/watch-market-cache-store.ts`
- Test: `tests/main/watch-market-service.test.ts`
- Test: `tests/main/watch-market-cache-store.test.ts`

**Steps:**

1. Write failing test: on 2026-06-06, provider returns `tradingDate=2026-06-05`; service writes cache under `2026-06-05`.
2. Validate `StockTrend.tradingDate` inside cache store.
3. Ensure cache history still limits to 5 real trading dates.
4. Run: `npm test -- tests/main/watch-market-service.test.ts tests/main/watch-market-cache-store.test.ts`

Expected: natural-date cache writes are removed.

### Task 6: Add Completeness Checks in WatchMarketService

**Files:**
- Modify: `src/main/watch-market-service.ts`
- Test: `tests/main/watch-market-service.test.ts`

**Steps:**

1. Add private helpers inside `watch-market-service.ts`:
   - China time minute formatting.
   - trading session detection.
   - required coverage minute.
   - trend completeness check.
2. Write failing tests:
   - trading morning requires points through current minute.
   - lunch requires coverage through `11:30`.
   - after close requires `15:00`.
   - gaps inside the required trading-minute range trigger refetch.
   - non-trading day uses provider trading date, not current date.
3. Implement minimal logic.
4. Run: `npm test -- tests/main/watch-market-service.test.ts`

Expected: incomplete cached data triggers provider refetch before drawing.

### Task 7: Refresh Every 10 Seconds

**Files:**
- Modify: `src/renderer/features/watch/watch-controller.ts`
- Test: existing renderer/controller tests if present, otherwise add focused source assertion to existing test style.

**Steps:**

1. Change polling interval from `15_000` to `10_000`.
2. Run renderer-related tests or full test suite.

Expected: watch polling interval is 10 seconds.

### Task 8: Update Architecture Documentation

**Files:**
- Modify: `docs/architecture.md`

**Steps:**

1. Document provider contract with `tradingDate`.
2. Document `data-calc-helper.ts`.
3. Document cache completeness and real trading date semantics.
4. Run: `git diff --check`

Expected: architecture doc matches implemented code.

### Task 9: Full Verification, Commit, Push, Deploy

**Files:**
- All changed files.

**Steps:**

1. Run: `npm test`
2. Run: `npm run build`
3. Run: `git diff --check`
4. Commit with a focused message.
5. Push branch.
6. Check whether Windows app is running with `tasklist.exe /FI "IMAGENAME eq A股调研助手.exe"`.
7. If running, ask user to close it.
8. Run: `npm run dist:win` and accept expected NSIS/Wine failure after `win-unpacked` refresh.
9. Run: `npm run deploy:win-unpacked`.

Expected: tests/build pass, branch pushed, desktop `win-unpacked` refreshed.
