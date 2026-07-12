# Watch News Activity Timeout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fixed watch-news timeout with a per-stock three-minute idle timeout and a twelve-minute maximum runtime.

**Architecture:** `CodexRunner` owns both timers because it observes parsed progress events and owns the child process. `CodexWatchNewsAnalysisProvider` supplies watch-news-specific durations; research runners remain unchanged unless they opt in.

**Tech Stack:** TypeScript, Node.js child processes, Vitest, Electron main process.

---

### Task 1: Specify timeout behavior

**Files:**
- Modify: `tests/fixtures/fake-codex.cjs`
- Modify: `tests/main/codex-runner.test.ts`
- Modify: `tests/main/watch-news-analysis-provider.test.ts`

1. Add fixture modes for finite and continuous progress.
2. Add failing tests for idle timeout, progress-based idle reset, maximum runtime, and provider timeout configuration.
3. Run `npm test -- tests/main/codex-runner.test.ts tests/main/watch-news-analysis-provider.test.ts` and confirm the new tests fail for missing options and behavior.

### Task 2: Implement activity-aware timers

**Files:**
- Modify: `src/main/codex-runner.ts`
- Modify: `src/main/watch-news-analysis-provider.ts`

1. Replace `timeoutMs` with optional `idleTimeoutMs` and `maxRuntimeMs`.
2. Start both timers per `CodexRunner` instance.
3. Reset only the idle timer when a parsed non-error event is received.
4. Return distinct timeout errors and stop the owned child process.
5. Configure watch-news runners with `180_000` and `720_000`.
6. Run the targeted tests and confirm they pass.

### Task 3: Document and verify

**Files:**
- Modify: `docs/architecture.md`

1. Replace the fixed 120-second description with the activity-aware policy.
2. Run `npm test`, `npm run build`, and `git diff --check`.
3. Build and deploy `win-unpacked` after confirming the app is closed.
4. Commit and push the code and documentation.

