# DeepSeek Model Selector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the filtering DeepSeek model datalist with a stable official-model select while preserving custom model names.

**Architecture:** Keep persistence and provider contracts unchanged. Add model/form conversion helpers to the existing renderer view-model, bind a native select and conditional custom input in `main.ts`, and retain main-process model validation.

**Tech Stack:** TypeScript, Electron renderer DOM, HTML select controls, Vitest.

---

### Task 1: Define model selection transformations

**Files:**
- Modify: `src/renderer/view-model.ts`
- Test: `tests/renderer/view-model.test.ts`

1. Write failing tests for official and custom saved values plus form submission.
2. Run `npm test -- tests/renderer/view-model.test.ts` and confirm the helpers are missing.
3. Implement official model constants and the two pure conversion helpers.
4. Re-run the focused test and confirm it passes.

### Task 2: Replace and bind the renderer controls

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app/dom.ts`
- Modify: `src/renderer/main.ts`
- Test: `tests/renderer/model-provider-settings-dialog.test.ts`

1. Write failing structure and binding assertions for a select, both official models, the custom option and custom input.
2. Run the focused renderer test and confirm it fails against the datalist implementation.
3. Replace the datalist, bind change/load/save behavior, and conditionally show the custom input.
4. Re-run the focused renderer tests and typecheck.

### Task 3: Document, verify and deploy

**Files:**
- Modify: `docs/architecture.md`

1. Document official/custom model selection and the renderer conversion behavior.
2. Run `npm test`, `npm run build`, and `git diff --check`.
3. Commit and push the code and documentation.
4. Check the Windows process without terminating it; when closed, run `npm run dist:win` and `npm run deploy:win-unpacked`.
5. Compare the built and deployed `app.asar` files.

