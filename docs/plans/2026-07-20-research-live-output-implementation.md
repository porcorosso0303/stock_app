# Research Live Output and Report Date Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display full timestamped DeepSeek reasoning and answer streams without token-level forced line breaks, and guarantee that report metadata uses the task creation date.

**Architecture:** Replace the provider callback's implicit string protocol with typed status/reasoning/answer events. Stamp events in `ResearchService`, render stream segments in the renderer, and normalize the report date in the service before persistence and PDF export.

**Tech Stack:** TypeScript, Electron IPC, DOM/CSS, Vitest, Vite.

---

### Task 1: Introduce structured provider output events

**Files:**
- Modify: `src/main/modules/research/providers/research-provider.ts`
- Modify: `src/main/modules/research/providers/codex-cli-provider.ts`
- Modify: `src/main/modules/research/providers/deepseek-provider.ts`
- Test: `tests/main/deepseek-research-provider.test.ts`
- Test: `tests/main/codex-cli-provider.test.ts`

**Steps:**

1. Add failing tests asserting that provider callbacks receive typed `status`, `reasoning`, and `answer` events.
2. Run the focused tests and verify they fail because callbacks still receive strings.
3. Add `ResearchProviderOutputEvent` and change `ResearchProviderRequest.onOutput` to accept it.
4. Map Codex display events to line status events and DeepSeek progress kinds to the appropriate line/stream events.
5. Run the focused tests and commit.

### Task 2: Expose the full DeepSeek reasoning stream

**Files:**
- Modify: `src/main/deepseek-agent-runner.ts`
- Test: `tests/main/deepseek-agent-runner.test.ts`

**Steps:**

1. Add a failing test that sends split `reasoning_content` SSE deltas and expects both raw deltas as progress events.
2. Run the test and verify the current implementation only emits length status messages.
3. Extend `DeepSeekAgentProgress.kind` with `reasoning` and emit every raw reasoning delta while retaining lightweight task status events.
4. Run the focused tests and commit.

### Task 3: Stamp output events and normalize report dates

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/research-service.ts`
- Modify: `src/main/modules/research/providers/research-provider.ts`
- Modify: `src/main/modules/research/providers/deepseek-provider.ts`
- Modify: `src/main/modules/research/providers/codex-cli-provider.ts`
- Modify: `src/main/codex-prompt.ts`
- Test: `tests/main/research-service.test.ts`
- Test: `tests/main/deepseek-research-provider.test.ts`
- Test: `tests/main/codex-cli-provider.test.ts`

**Steps:**

1. Add failing tests for `occurredAt`, provider `researchDate`, and replacement of a stale Markdown report date.
2. Run focused tests and confirm the missing behavior.
3. Pass the task `createdAt` through `ResearchProviderRequest`, add it to both prompts, and stamp every output event in `ResearchService`.
4. Add a focused report-date normalization helper inside `research-service.ts` and apply it before both Markdown persistence and PDF export.
5. Run focused tests and commit.

### Task 4: Render timestamped stream segments at full width

**Files:**
- Modify: `src/renderer/features/research/research-controller.ts`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer/research-controller.test.ts`
- Test: `tests/renderer/research-output-layout.test.ts`

**Steps:**

1. Add failing renderer tests for token concatenation, timestamp labels, reasoning/answer transitions, and stream reset on a new task.
2. Add a failing style test for the required width and wrapping declarations.
3. Implement a small renderer-local stream writer that only prefixes a new segment and otherwise appends text verbatim.
4. Add `min-width`, `width`, `white-space`, `overflow-wrap`, and `word-break` constraints to the output panel hierarchy.
5. Run renderer tests and commit.

### Task 5: Documentation and final verification

**Files:**
- Modify: `docs/architecture.md`

**Steps:**

1. Document the structured output boundary, timestamp ownership, full DeepSeek reasoning stream, renderer grouping, and report-date normalization.
2. Run `npm test` and expect all tests to pass.
3. Run `npm run build` and expect typecheck plus production builds to pass.
4. Run `git diff --check` and expect no output.
5. Commit the architecture update.
6. Confirm the Windows process is closed, run `npm run dist:win`, deploy `win-unpacked`, verify matching `app.asar` checksums, and push the branch.
