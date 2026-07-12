# 持仓股消息实时 Debug Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让用户在模型运行期间实时看到完整过程、原始输出和错误，并在单股分析完成后直接看到消息结果。

**Architecture:** 复用现有 Debug 读取 IPC，provider 返回运行状态与完整 `events.jsonl`，renderer 在 Debug 面板打开期间每秒轮询。单股分析完成后复用历史消息面板展示结果，不新增 provider、service 或 renderer 源文件。

**Tech Stack:** Electron、TypeScript、Vitest、现有 JSON 文件存储与 IPC。

---

### Task 1: Debug 数据完整性

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/watch-news-analysis-provider.ts`
- Test: `tests/main/watch-news-analysis-provider.test.ts`

**Step 1: Write the failing tests**

增加测试，写入只包含启动事件的 `events.jsonl`，断言 Debug 返回 `status: "running"` 和完整 `rawEvents`；再覆盖存在 report 时为 `completed`、存在 meta 错误时为 `failed`。

**Step 2: Run tests to verify failure**

Run: `npx vitest run tests/main/watch-news-analysis-provider.test.ts`

Expected: FAIL，因为 `WatchNewsDebugRun` 尚无状态和原始事件字段。

**Step 3: Implement the minimal data changes**

在 `WatchNewsDebugRun` 增加 `status` 与 `rawEvents`。`getLatestDebugRun()` 根据 `meta.errorMessage`、非空 report 推断状态，并原样返回 `events.jsonl`。

**Step 4: Run tests to verify pass**

Run: `npx vitest run tests/main/watch-news-analysis-provider.test.ts`

Expected: PASS。

### Task 2: Debug 窗口实时刷新

**Files:**
- Modify: `src/renderer/features/watch/watch-controller.ts`
- Test: `tests/renderer/watch-holding-editor-behavior.test.ts`

**Step 1: Write the failing test**

打开单股 Debug，断言首次读取后注册一秒定时器；触发定时回调后再次读取并渲染更新后的 report 和原始 JSONL；关闭窗口后断言定时器被清除。

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/renderer/watch-holding-editor-behavior.test.ts`

Expected: FAIL，因为 Debug 当前只读取一次且不展示原始 JSONL。

**Step 3: Implement polling and rendering**

在 controller 内保存当前 Debug `secid` 和定时器。打开时立即加载并每秒刷新；关闭及 deactivate 时停止。面板增加状态和“原始 JSONL”区段。

**Step 4: Run test to verify pass**

Run: `npx vitest run tests/renderer/watch-holding-editor-behavior.test.ts`

Expected: PASS。

### Task 3: 单股分析结果直接展示

**Files:**
- Modify: `src/renderer/features/watch/watch-controller.ts`
- Test: `tests/renderer/watch-holding-editor-behavior.test.ts`

**Step 1: Write the failing test**

模拟单股分析返回新消息，断言分析完成后读取该股票历史并打开历史面板，内容包含模型分析；无消息时不打开空面板。

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/renderer/watch-holding-editor-behavior.test.ts`

Expected: FAIL，因为当前只更新状态和脑图消息标记。

**Step 3: Implement result display**

`refreshStockNews()` 完成后读取最新历史；非空时调用现有 `renderNewsHistoryPanel()`，为空时仅保留明确状态。

**Step 4: Run test to verify pass**

Run: `npx vitest run tests/renderer/watch-holding-editor-behavior.test.ts`

Expected: PASS。

### Task 4: 文档、全量验证与部署

**Files:**
- Modify: `docs/architecture.md`

**Step 1: Update architecture documentation**

记录 Debug 状态推断、原始 JSONL、轮询生命周期和单股结果展示行为。

**Step 2: Run full verification**

Run: `npm test`

Expected: 全部测试通过。

Run: `npm run build`

Expected: 类型检查、main 和 renderer 构建通过。

**Step 3: Package and deploy**

检查 Windows 程序是否运行；如运行则通知用户关闭。否则运行 `npm run dist:win` 生成 `release/win-unpacked`，再运行 `npm run deploy:win-unpacked`。

**Step 4: Commit and push**

提交代码、测试和架构文档并推送当前分支。
