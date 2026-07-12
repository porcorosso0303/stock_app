# Watch News Two-Stage Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist authoritative announcement candidates immediately and upgrade them in place after AI analysis.

**Architecture:** The provider emits partial drafts through an async callback. The service owns persistence and change notification, while the store upgrades fallback records sharing the same dedupe key.

**Tech Stack:** TypeScript, Electron IPC events, Vitest, JSON persistence.

---

### Task 1: Specify partial-result behavior

**Files:**
- Modify: `tests/main/watch-news-analysis-provider.test.ts`
- Modify: `tests/main/watch-news-store-service.test.ts`

1. Add a failing provider test proving important announcement drafts are emitted before runner completion.
2. Add a failing service test proving partial drafts are stored and notified before another stock finishes.
3. Add a failing store test proving full AI content upgrades a fallback without duplication.
4. Run the two targeted test files and confirm failures are caused by missing partial-result APIs.

### Task 2: Implement the two-stage flow

**Files:**
- Modify: `src/main/watch-news-analysis-provider.ts`
- Modify: `src/main/watch-news-service.ts`
- Modify: `src/main/watch-news-store.ts`

1. Add optional async `onPartialDrafts` to `WatchNewsAnalysisProvider.analyze()`.
2. Emit material fallback drafts before Codex environment detection and runner creation.
3. Persist partial drafts immediately inside each service worker.
4. Upgrade fallback records when complete AI drafts share the same dedupe key.
5. Run targeted tests and confirm they pass.

### Task 3: Notify renderer and document

**Files:**
- Modify: `src/main/index.ts`
- Modify: `docs/architecture.md`

1. Inject the existing renderer notification callback into `WatchNewsService`.
2. Document the two-stage provider/service/store data flow.
3. Run `npm test`, `npm run build`, and `git diff --check`.
4. Build and deploy `win-unpacked` after confirming the app is closed.
5. Commit and push all code and documentation.

