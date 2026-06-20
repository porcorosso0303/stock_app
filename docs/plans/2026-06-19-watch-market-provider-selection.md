# Watch Market Provider Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a top menu data source selector with EastMoney and replayed mock market data providers.

**Architecture:** Keep `WatchMarketService` depending on a single `MarketDataProvider` interface by inserting a selectable delegating provider. Implement mock data as a normal provider that reads the latest real cache day and replays it from the first intraday point according to the existing refresh cadence. Renderer only receives provider-change events and refreshes; it does not branch on data source for drawing logic.

**Tech Stack:** Electron main menu, TypeScript, Vitest, existing IPC/preload bridge, existing watch cache store.

---

### Task 1: Config And Menu Contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/config-store.ts`
- Create: `src/main/app-menu.ts`
- Test: `tests/main/config-store.test.ts`
- Test: `tests/main/app-menu.test.ts`

**Steps:**
1. Write failing tests for persisting `watchMarketProviderId` and menu radio items.
2. Add `WatchMarketProviderId` type and config setter.
3. Add a pure menu-template builder with `Setting -> 数据源选择 -> 东方财富/模拟数据`.
4. Run targeted tests.

### Task 2: Provider Selection And Mock Provider

**Files:**
- Create: `src/main/modules/watch/market-data/selectable-market-data-provider.ts`
- Create: `src/main/modules/watch/market-data/mock-cache-provider.ts`
- Modify: `src/main/modules/watch/market-data/market-data-provider.ts`
- Modify: `src/main/watch-market-service.ts`
- Test: `tests/main/selectable-market-data-provider.test.ts`
- Test: `tests/main/mock-cache-provider.test.ts`
- Test: `tests/main/watch-market-service.test.ts`

**Steps:**
1. Write failing tests for provider delegation, mock replay from first point, and non-persistent ephemeral provider results.
2. Implement selectable provider wrapper.
3. Implement mock provider reading latest cached real day and replaying by elapsed 10 second steps.
4. Teach `WatchMarketService` to skip cache read/write for `cacheBehavior: "ephemeral"` providers.
5. Run targeted tests.

### Task 3: Wire Main, IPC, Renderer Refresh

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/app-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/features/watch/watch-controller.ts`
- Test: `tests/main/ipc.test.ts`
- Test: `tests/renderer/watch-provider-change.test.ts`

**Steps:**
1. Write failing tests for IPC/provider-change exposure and renderer refresh hook.
2. Wire selected provider from config at startup.
3. Menu click saves config, switches provider, sends renderer event.
4. Renderer refreshes watch market data when provider changes while active.
5. Run targeted tests.

### Task 4: Docs And Verification

**Files:**
- Modify: `docs/architecture.md`

**Steps:**
1. Document provider selection and mock replay behavior.
2. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run dist:win`, and `npm run deploy:win-unpacked`.
