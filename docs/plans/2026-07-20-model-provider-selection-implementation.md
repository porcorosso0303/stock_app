# Selectable Model Providers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add task-snapshotted OpenAI Codex and DeepSeek model-provider selection for stock research and watch-news analysis, with encrypted credentials and Tavily-backed web tools.

**Architecture:** Preserve the existing task-specific `ResearchProvider` and `WatchNewsAnalysisProvider` boundaries. A new `ModelProviderManager` reads current settings only when a task begins and returns immutable providers; DeepSeek uses a direct streaming chat-completions agent with Tavily search/extract tools, while Codex retains its current CLI implementation.

**Tech Stack:** Electron 42, TypeScript 6, Node.js, Vitest, Electron `safeStorage`, DeepSeek OpenAI-compatible HTTP/SSE API, Tavily Search/Extract REST APIs.

---

### Task 1: Model configuration and encrypted secrets

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`
- Create: `src/main/model-secrets-store.ts`
- Modify: `tests/main/config-store.test.ts`
- Create: `tests/main/model-secrets-store.test.ts`

**Step 1: Write failing configuration tests**

Add tests proving:

- an empty/legacy config resolves to `codex-cli`, `https://api.deepseek.com`, and `deepseek-v4-pro`;
- legacy `researchProviderId: "codex-cli"` maps to the new field;
- a valid DeepSeek setting is persisted without API keys;
- non-local HTTP Base URLs, empty models, and unknown provider IDs are rejected;
- `localhost` and `127.0.0.1` HTTP URLs are accepted.

Add the public structures:

```ts
export type ModelProviderId = "codex-cli" | "deepseek";

export interface ModelProviderSettings {
  providerId: ModelProviderId;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
}

export interface ModelProviderSettingsView extends ModelProviderSettings {
  hasDeepSeekApiKey: boolean;
  hasTavilyApiKey: boolean;
}
```

**Step 2: Run tests and verify failure**

Run: `npx vitest run tests/main/config-store.test.ts tests/main/model-secrets-store.test.ts`

Expected: FAIL because model setting methods and the secrets store do not exist.

**Step 3: Implement normalized configuration**

Add pure normalization/validation in `config-store.ts` and expose:

```ts
getModelProviderSettings(): Promise<ModelProviderSettings>;
setModelProviderSettings(settings: ModelProviderSettings): Promise<AppConfig>;
```

Keep `get()` backward compatible and never write credentials into `AppConfig`.

**Step 4: Implement encrypted secrets store**

Use an injected crypto boundary so tests do not import a live Electron app:

```ts
export interface SecretCryptography {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ModelSecretsStore {
  getStatus(): Promise<{ hasDeepSeekApiKey: boolean; hasTavilyApiKey: boolean }>;
  getSecrets(): Promise<{ deepSeekApiKey?: string; tavilyApiKey?: string }>;
  update(input: { deepSeekApiKey?: string; tavilyApiKey?: string; clearDeepSeekApiKey?: boolean; clearTavilyApiKey?: boolean }): Promise<void>;
}
```

Persist Base64 ciphertext in versioned JSON. Reject saves when encryption is unavailable and never fall back to plaintext.

**Step 5: Run focused tests**

Run: `npx vitest run tests/main/config-store.test.ts tests/main/model-secrets-store.test.ts`

Expected: PASS, including assertions that known plaintext keys do not appear in the file.

**Step 6: Commit**

```bash
git add src/shared/types.ts src/main/config-store.ts src/main/model-secrets-store.ts tests/main/config-store.test.ts tests/main/model-secrets-store.test.ts
git commit -m "feat: store model settings and encrypted secrets"
```

### Task 2: Model-service setting IPC and dialog

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/app-ipc.ts`
- Modify: `src/main/app-menu.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app/dom.ts`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/styles.css`
- Modify: `tests/main/app-menu.test.ts`
- Modify: `tests/main/ipc.test.ts`
- Modify: `tests/preload/preload-sandbox.test.ts`
- Create: `tests/renderer/model-provider-settings-dialog.test.ts`

**Step 1: Write failing menu, IPC, preload, and renderer tests**

Cover:

- `Setting > 模型服务` invokes a dedicated open callback;
- renderer API can get/save model settings and listen for the open event;
- get IPC returns status booleans but never saved key text/ciphertext;
- save IPC accepts optional replacement keys and explicit clear flags;
- dialog toggles Codex/DeepSeek sections, validates inputs, displays configured state, and stays open on error.

Use this save contract:

```ts
export interface SaveModelProviderSettingsRequest extends ModelProviderSettings {
  deepSeekApiKey?: string;
  tavilyApiKey?: string;
  clearDeepSeekApiKey?: boolean;
  clearTavilyApiKey?: boolean;
}
```

**Step 2: Run tests and verify failure**

Run: `npx vitest run tests/main/app-menu.test.ts tests/main/ipc.test.ts tests/preload/preload-sandbox.test.ts tests/renderer/model-provider-settings-dialog.test.ts`

Expected: FAIL on missing IPC names, menu item, API methods, and dialog markup.

**Step 3: Add IPC contracts and main-process handlers**

Add:

```text
model-provider-settings:get
model-provider-settings:set
model-provider-settings:open
```

The get handler combines normalized non-secret config with `ModelSecretsStore.getStatus()`. The set handler validates config first, updates secrets, then persists non-secret config; it returns only `ModelProviderSettingsView`.

**Step 4: Add the independent setting dialog**

Build the dialog with:

- provider radio/select;
- Codex environment status and re-detect button;
- editable DeepSeek model list with `deepseek-v4-pro` and `deepseek-v4-flash`;
- Base URL;
- password fields that remain empty when a key is already saved;
- configured/unconfigured text and clear actions;
- inline validation/error status.

No secret may be injected into DOM attributes or returned by bootstrap.

**Step 5: Run focused tests**

Run: `npx vitest run tests/main/app-menu.test.ts tests/main/ipc.test.ts tests/preload/preload-sandbox.test.ts tests/renderer/model-provider-settings-dialog.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/app-ipc.ts src/main/app-menu.ts src/main/index.ts src/renderer/index.html src/renderer/app/dom.ts src/renderer/main.ts src/renderer/styles.css tests/main/app-menu.test.ts tests/main/ipc.test.ts tests/preload/preload-sandbox.test.ts tests/renderer/model-provider-settings-dialog.test.ts
git commit -m "feat: add model service settings dialog"
```

### Task 3: Task-level provider snapshots

**Files:**
- Create: `src/main/model-provider-manager.ts`
- Modify: `src/main/research-service.ts`
- Modify: `src/main/watch-news-service.ts`
- Modify: `tests/main/research-service.test.ts`
- Modify: `tests/main/watch-news-store-service.test.ts`
- Create: `tests/main/model-provider-manager.test.ts`

**Step 1: Write failing snapshot tests**

Research tests must prove:

- the resolver is called once when `start()` begins;
- `detect()`, `run()`, and `cancel()` use the same returned Provider;
- changing resolver output while `run()` is pending does not switch the active task;
- the next task gets the newly selected Provider.

Watch-news tests must prove:

- one batch resolves one Provider, not one per stock;
- all concurrent stocks in a batch use that Provider;
- a later batch observes a setting change;
- `getLatestDebugRun()` does not silently query an unrelated newly selected Provider; the service keeps the last-used provider for debug lookup.

**Step 2: Run tests and verify failure**

Run: `npx vitest run tests/main/research-service.test.ts tests/main/watch-news-store-service.test.ts tests/main/model-provider-manager.test.ts`

Expected: FAIL because services currently receive fixed providers.

**Step 3: Change services to resolver dependencies**

Use explicit resolvers:

```ts
interface ModelProviderResolver {
  resolveResearchProvider(): Promise<ResearchProvider>;
  resolveWatchNewsProvider(): Promise<WatchNewsAnalysisProvider>;
}
```

In `ResearchService.start()`, resolve before detection and assign the same object to `active`. In `WatchNewsService.analyzeStocks()`, resolve once before starting concurrent workers and pass the local Provider into each analysis call.

**Step 4: Implement the manager boundary**

`ModelProviderManager` reads normalized config and decrypted secrets when a resolver method is invoked. It validates required keys and delegates construction to injected Codex and DeepSeek factories. Error messages name the missing setting.

**Step 5: Run focused tests**

Run: `npx vitest run tests/main/research-service.test.ts tests/main/watch-news-store-service.test.ts tests/main/model-provider-manager.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/main/model-provider-manager.ts src/main/research-service.ts src/main/watch-news-service.ts tests/main/research-service.test.ts tests/main/watch-news-store-service.test.ts tests/main/model-provider-manager.test.ts
git commit -m "refactor: snapshot model providers per task"
```

### Task 4: Tavily web tools

**Files:**
- Create: `src/main/tavily-web-tools.ts`
- Create: `tests/main/tavily-web-tools.test.ts`

**Step 1: Write failing adapter tests**

Cover:

- Search calls `https://api.tavily.com/search` with Bearer auth and expected JSON fields;
- Extract calls `/extract` and normalizes successful/failed URLs;
- topic, day/date, include-domain, exclude-domain, and result-count filters are preserved;
- only HTTP(S) extract URLs are accepted;
- URL count, result count, and text size limits are enforced;
- 401, quota, malformed JSON, timeout, and cancellation map to safe Chinese errors;
- thrown errors and debug events contain no API key or Authorization value.

**Step 2: Run test and verify failure**

Run: `npx vitest run tests/main/tavily-web-tools.test.ts`

Expected: FAIL because `TavilyWebTools` does not exist.

**Step 3: Implement the adapter**

Use an injected HTTP transport with `AbortSignal`. Return provider-neutral structures:

```ts
interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedAt?: string;
}

interface WebExtractResult {
  url: string;
  content?: string;
  errorMessage?: string;
}
```

Do not place credentials in query parameters. Redact headers and configured key values before emitting debug text.

**Step 4: Run test**

Run: `npx vitest run tests/main/tavily-web-tools.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/tavily-web-tools.ts tests/main/tavily-web-tools.test.ts
git commit -m "feat: add Tavily web tools"
```

### Task 5: DeepSeek streaming tool-call agent

**Files:**
- Create: `src/main/deepseek-agent-runner.ts`
- Create: `tests/main/deepseek-agent-runner.test.ts`

**Step 1: Write failing protocol tests**

Use a scripted fake transport and test:

- request URL resolves to `{baseUrl}/chat/completions` without duplicate slashes;
- request uses Bearer auth, configured model, `stream: true`, tools, and `tool_choice: "auto"`;
- SSE content and reasoning deltas are combined correctly;
- split `tool_calls[].function.arguments` fragments are combined by index/id;
- `[DONE]` terminates a turn;
- after a tool call, the next request replays assistant `reasoning_content`, `content`, and `tool_calls`, followed by matching tool messages;
- invalid JSON arguments and unknown tools become structured tool errors, not process crashes;
- tool rounds, output length, and execution time are bounded;
- AbortSignal cancels HTTP and tool execution;
- HTTP auth, balance, model, and network errors map to actionable Chinese messages;
- progress/debug output contains provider/model/tool metadata but no API key.

**Step 2: Run test and verify failure**

Run: `npx vitest run tests/main/deepseek-agent-runner.test.ts`

Expected: FAIL because the agent runner does not exist.

**Step 3: Implement SSE parsing and one completion turn**

Implement a stateful parser that accepts arbitrary byte chunk boundaries and yields a normalized assistant turn. Keep `reasoning_content` separate from visible `content`.

**Step 4: Implement the bounded tool loop**

Define strict runtime validators for `web_search` and `web_extract`. Execute them through `TavilyWebTools`, append tool results, and continue until the model returns a final non-tool response.

Emit progress events for request start, model activity, tool start/result, retry, completion, cancellation, and failure.

**Step 5: Run focused tests**

Run: `npx vitest run tests/main/deepseek-agent-runner.test.ts tests/main/tavily-web-tools.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/main/deepseek-agent-runner.ts tests/main/deepseek-agent-runner.test.ts
git commit -m "feat: add DeepSeek tool calling agent"
```

### Task 6: DeepSeek stock research provider

**Files:**
- Create: `src/main/modules/research/providers/deepseek-provider.ts`
- Modify: `src/main/research-spec-store.ts`
- Create: `tests/main/deepseek-research-provider.test.ts`
- Modify: `tests/main/provider-selection-wiring.test.ts`

**Step 1: Write failing provider tests**

Cover:

- `detect()` reports available only when validated immutable settings are present;
- `run()` includes stock name, current research specification, evidence/citation rules, and expected report structure;
- agent progress is forwarded through `onOutput`;
- final Markdown is returned as a normal `ResearchProviderResult`;
- empty final output, cancellation, and agent errors map to existing statuses;
- no Codex skill path or CLI locator is required by the DeepSeek provider.

**Step 2: Run tests and verify failure**

Run: `npx vitest run tests/main/deepseek-research-provider.test.ts tests/main/provider-selection-wiring.test.ts`

Expected: FAIL because the DeepSeek research provider/factory is absent.

**Step 3: Implement provider-neutral research prompt building**

Read the same user-edited research specification used by Codex. Build a DeepSeek system/user prompt that requires:

- current, source-attributed A-share research;
- official announcements and financial reports first;
- facts separated from inference;
- publication dates and direct URLs;
- risks and contradictory evidence;
- the existing Markdown report sections.

**Step 4: Implement `DeepSeekResearchProvider`**

Wrap one immutable DeepSeek agent instance per task Provider. `cancel()` aborts only that instance. Return the same provider result structure consumed by `ResearchService`.

**Step 5: Run focused tests**

Run: `npx vitest run tests/main/deepseek-research-provider.test.ts tests/main/research-service.test.ts tests/main/provider-selection-wiring.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/main/modules/research/providers/deepseek-provider.ts src/main/research-spec-store.ts tests/main/deepseek-research-provider.test.ts tests/main/provider-selection-wiring.test.ts
git commit -m "feat: add DeepSeek stock research provider"
```

### Task 7: Share watch-news orchestration and add DeepSeek analysis

**Files:**
- Modify: `src/main/watch-news-analysis-provider.ts`
- Modify: `tests/main/watch-news-analysis-provider.test.ts`
- Create: `tests/main/deepseek-watch-news-provider.test.ts`

**Step 1: Write failing common-orchestration tests**

Preserve all existing Codex assertions and add tests proving both implementations share:

- EastMoney announcement prefetch;
- normal 48-hour and initial 7-day windows;
- existing-message dedupe context;
- `WatchNewsDraft[]` validation;
- immediate partial persistence callback;
- important prefetched-announcement fallback when model/Tavily fails;
- 3-minute inactivity and 12-minute maximum timeout semantics;
- provider/model/tool progress in the existing debug run structure.

DeepSeek-specific tests verify source/domain instructions for company websites, SSE/SZSE interaction platforms, EastMoney, The Paper, Jiemian, STAR Market Daily, official investor Q&A, and Xueqiu clue verification.

**Step 2: Run tests and verify failure**

Run: `npx vitest run tests/main/watch-news-analysis-provider.test.ts tests/main/deepseek-watch-news-provider.test.ts`

Expected: FAIL because common orchestration and DeepSeek execution are not available.

**Step 3: Refactor without changing the public interface**

Keep the existing file as the ownership boundary. Extract internal common functions/classes for prefetch, prompt context, result validation, debug persistence, timeout supervision, and fallback. Keep `CodexWatchNewsAnalysisProvider` behavior unchanged.

**Step 4: Add DeepSeek watch-news implementation**

Use the same immutable DeepSeek agent/Tavily tool bundle and require a strict JSON/Markdown result that normalizes to `WatchNewsDraft[]`. Forum claims must be checked against authoritative sources; include analysis and confidence for every retained item.

**Step 5: Run focused regression tests**

Run: `npx vitest run tests/main/watch-news-analysis-provider.test.ts tests/main/deepseek-watch-news-provider.test.ts tests/main/watch-news-store-service.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/main/watch-news-analysis-provider.ts tests/main/watch-news-analysis-provider.test.ts tests/main/deepseek-watch-news-provider.test.ts
git commit -m "feat: analyze watch news with DeepSeek"
```

### Task 8: Production wiring and end-to-end selection

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/app-ipc.ts`
- Modify: `src/main/modules/research/research-ipc.ts`
- Modify: `src/main/modules/watch/watch-ipc.ts`
- Modify: `tests/main/provider-selection-wiring.test.ts`
- Modify: `tests/integration/fake-codex-flow.test.ts`
- Create: `tests/integration/model-provider-selection.test.ts`

**Step 1: Write failing wiring tests**

Assert:

- missing model settings keep the existing Codex path working;
- selecting DeepSeek constructs both DeepSeek business Providers with one immutable settings snapshot per task;
- a settings save during a pending fake research task leaves it on the original fake Provider;
- a settings save during a pending watch-news batch leaves every stock on the original fake Provider;
- subsequent tasks use the newly selected Provider;
- missing DeepSeek/Tavily key messages are surfaced through existing IPC errors;
- task debug/log output is redacted.

**Step 2: Run tests and verify failure**

Run: `npx vitest run tests/main/provider-selection-wiring.test.ts tests/integration/fake-codex-flow.test.ts tests/integration/model-provider-selection.test.ts`

Expected: FAIL because `index.ts` still constructs fixed Codex providers.

**Step 3: Wire stores, transport, factories, and manager**

In `index.ts`:

- create `ModelSecretsStore` at `join(userData, "model-secrets.json")` using Electron `safeStorage`;
- create the application HTTP transport using Electron networking;
- build Codex and DeepSeek Provider factories;
- create one `ModelProviderManager`;
- inject resolver functions into `ResearchService` and `WatchNewsService`;
- inject stores into model-settings IPC;
- pass the model-settings menu callback.

Do not cache decrypted secrets in global mutable state.

**Step 4: Run integration tests**

Run: `npx vitest run tests/main/provider-selection-wiring.test.ts tests/integration/fake-codex-flow.test.ts tests/integration/model-provider-selection.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/index.ts src/main/app-ipc.ts src/main/modules/research/research-ipc.ts src/main/modules/watch/watch-ipc.ts tests/main/provider-selection-wiring.test.ts tests/integration/fake-codex-flow.test.ts tests/integration/model-provider-selection.test.ts
git commit -m "feat: route tasks through selected model provider"
```

### Task 9: Documentation, full verification, and Windows deployment

**Files:**
- Modify: `docs/architecture.md`
- Modify as required by implementation: `docs/plans/2026-07-20-model-provider-selection-design.md`

**Step 1: Update the architecture reference**

Document the final code, not the implementation history:

- user-data files and encrypted secrets;
- settings IPC/UI;
- model Provider bundle and task snapshot lifecycle;
- Codex and DeepSeek research paths;
- DeepSeek Agent SSE/tool loop;
- Tavily adapter;
- watch-news common orchestration, fallback, and debug behavior;
- extension procedure for a future model provider.

Check the approved design document against actual names and update only genuine deviations.

**Step 2: Run all automated verification**

Run: `npm test`

Expected: all Vitest suites pass.

Run: `npm run build`

Expected: typecheck, Node build, and renderer Vite build all pass.

Run: `git diff --check`

Expected: no whitespace errors.

**Step 3: Request app closure before deployment**

Check for the Windows application process without terminating it. If it is running, notify the user and wait for them to close it, following the established deployment rule.

**Step 4: Deploy the Windows unpacked build**

Run: `npm run deploy:win-unpacked`

Expected: build succeeds and the desktop `win-unpacked` directory is synchronized. Do not run the GUI application; notify the user that deployment is ready for their test.

**Step 5: Commit documentation and any final verification fixes**

```bash
git add docs/architecture.md docs/plans/2026-07-20-model-provider-selection-design.md
git commit -m "docs: document selectable model providers"
```

**Step 6: Review, push, and report**

Use `superpowers:requesting-code-review` before integration, then `superpowers:verification-before-completion` before claiming success.

Run: `git status --short`

Expected: clean worktree.

Run: `git push`

Expected: current feature branch is updated on the configured remote.

Report the deployed version, commits, test/build results, and any DeepSeek/Tavily live-network verification that still requires the user's own keys.
