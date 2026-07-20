# DeepSeek Thinking Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Explicitly enable DeepSeek thinking on every request and let users persist a `high` or `max` reasoning effort, defaulting to `high`.

**Architecture:** Extend the existing shared model-provider settings contract and keep validation in `ConfigStore`/IPC. The renderer edits the typed setting, `ModelProviderManager` snapshots it at task start, and `DeepSeekAgentRunner` writes both DeepSeek request parameters on every agent round.

**Tech Stack:** TypeScript, Electron IPC, DOM renderer, Vitest, DeepSeek OpenAI-compatible Chat Completions API.

---

### Task 1: Extend and validate the persisted settings contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`
- Test: `tests/main/config-store.test.ts`

**Step 1: Write failing tests**

Add tests proving that missing stored effort defaults to `high`, `max` persists, and unsupported values are rejected by normalization.

**Step 2: Verify the tests fail**

Run: `npm test -- tests/main/config-store.test.ts`

Expected: failures because `deepSeekReasoningEffort` is absent from the settings contract.

**Step 3: Implement the minimal contract**

Add `DeepSeekReasoningEffort = "high" | "max"`, add the field to settings/config types, default it to `high`, persist it, and validate it.

**Step 4: Verify the tests pass**

Run: `npm test -- tests/main/config-store.test.ts`

Expected: all config-store tests pass.

### Task 2: Carry the setting through IPC and the settings dialog

**Files:**
- Modify: `src/main/app-ipc.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app/dom.ts`
- Modify: `src/renderer/main.ts`
- Test: `tests/main/ipc.test.ts`
- Test: `tests/renderer/model-provider-settings-dialog.test.ts`

**Step 1: Write failing tests**

Assert that IPC reads and saves `deepSeekReasoningEffort`, the dialog contains a `high/max` select, and renderer code loads and submits the field.

**Step 2: Verify the tests fail**

Run: `npm test -- tests/main/ipc.test.ts tests/renderer/model-provider-settings-dialog.test.ts`

Expected: failures for missing IPC field and DOM binding.

**Step 3: Implement the minimal UI and IPC changes**

Add a DeepSeek reasoning effort select, bind it through `dom.ts` and `main.ts`, and require the submitted string in IPC before shared validation.

**Step 4: Verify the tests pass**

Run: `npm test -- tests/main/ipc.test.ts tests/renderer/model-provider-settings-dialog.test.ts`

Expected: both suites pass.

### Task 3: Explicitly configure every DeepSeek request

**Files:**
- Modify: `src/main/deepseek-agent-runner.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/deepseek-agent-runner.test.ts`
- Update affected fixtures in: `tests/main/model-provider-manager.test.ts`, `tests/integration/model-provider-selection.test.ts`, `tests/renderer/*.test.ts`

**Step 1: Write failing runner tests**

Capture HTTP request bodies and assert that the initial request and the request after a tool result contain:

```ts
thinking: { type: "enabled" },
reasoning_effort: "max"
```

**Step 2: Verify the tests fail**

Run: `npm test -- tests/main/deepseek-agent-runner.test.ts`

Expected: request-body assertions fail.

**Step 3: Implement request propagation**

Add the typed effort to runner options, pass the settings snapshot from `main/index.ts`, and include both explicit parameters in every `complete()` request.

**Step 4: Repair typed fixtures without changing behavior**

Add `deepSeekReasoningEffort: "high"` to settings fixtures that construct the now-required shared contract.

**Step 5: Verify focused tests**

Run: `npm test -- tests/main/deepseek-agent-runner.test.ts tests/main/model-provider-manager.test.ts tests/integration/model-provider-selection.test.ts`

Expected: all focused tests pass.

### Task 4: Document and verify

**Files:**
- Modify: `docs/architecture.md`

**Step 1: Update architecture documentation**

Document the persisted effort setting, default/migration behavior, immutable task snapshot, and explicit DeepSeek request parameters.

**Step 2: Run static and full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands pass.

**Step 3: Commit implementation and documentation**

```bash
git add src tests docs/architecture.md docs/plans/2026-07-20-deepseek-thinking-settings-implementation.md
git commit -m "feat: configure DeepSeek reasoning effort"
```

### Task 5: Push and deploy the Windows unpacked build

**Step 1: Push the branch**

Run: `git push`

Expected: `feature/a-share-research-desktop` is synchronized with origin.

**Step 2: Check whether the Windows application is running**

Run: `tasklist.exe /FI "IMAGENAME eq A股调研助手.exe"`

If it is running, stop and ask the user to close it. Do not terminate it automatically.

**Step 3: Build and deploy**

Run:

```bash
npm run dist:win
npm run deploy:win-unpacked
```

The NSIS installer may fail after producing `release/win-unpacked` when Wine is unavailable; verify and deploy the unpacked directory in that case.

**Step 4: Verify deployment identity**

Compare `release/win-unpacked/resources/app.asar` with the desktop deployment and confirm a clean git status.

