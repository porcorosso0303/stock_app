# 消息窗口关闭按钮 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复消息历史窗口关闭按钮被标题栏拖拽指针捕获干扰的问题。

**Architecture:** 在现有 renderer controller 的拖拽入口排除按钮，不新增文件或模块。通过行为测试覆盖指针按下和点击关闭的完整交互。

**Tech Stack:** TypeScript、Vitest、Electron renderer。

---

### Task 1: 回归测试与修复

**Files:**
- Modify: `tests/renderer/watch-holding-editor-behavior.test.ts`
- Modify: `src/renderer/features/watch/watch-controller.ts`

**Step 1:** 增加失败测试，验证按钮 `pointerdown` 不调用标题栏 `setPointerCapture()`，随后点击可隐藏面板。

**Step 2:** 运行 `npx vitest run tests/renderer/watch-holding-editor-behavior.test.ts`，确认测试因现有拖拽入口捕获按钮指针而失败。

**Step 3:** 在 `beginNewsPanelDrag()` 中排除位于 `button` 内的事件目标。

**Step 4:** 重跑定向测试并确认通过。

### Task 2: 验证与部署

**Files:**
- Modify: `docs/architecture.md`

**Step 1:** 补充浮动消息窗口的拖拽与交互控件规则。

**Step 2:** 运行 `npm test` 和 `npm run build`。

**Step 3:** 检查程序进程，生成并部署 Windows `win-unpacked`。

**Step 4:** 提交并推送代码、测试和文档。
