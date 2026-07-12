# 持仓股消息实时 Debug 设计

## 背景

持仓股消息分析的 Codex CLI 运行时间可能达到数分钟。当前 Debug 窗口只在打开时读取一次运行目录快照，并且只展示 `CodexJsonlParser` 筛选后的事件。用户在模型运行期间打开窗口时，看不到后续搜索、最终模型输出或错误；即使模型最终成功，单股“最新消息”操作也不会直接展示消息历史，容易被误认为没有输出。

2026-07-12 的中控技术实际运行记录表明：Codex 在一次可恢复的连接超时后完成搜索，生成了有效 JSON，并写入 `watch-news.json`。因此本次改动针对可观测性和结果反馈，不修改消息抓取或模型 provider 协议。

## 方案

### Debug 数据

在现有 `WatchNewsDebugRun` 中增加：

- `status`：`running | completed | failed`。
- `rawEvents`：`events.jsonl` 的完整原始文本。

`CodexWatchNewsAnalysisProvider.getLatestDebugRun()` 继续读取现有运行目录。存在 `meta.errorMessage` 时为失败；存在非空 `report.md` 时为完成；否则为运行中。原有解析事件、stderr、prompt 和 report 保持不变。

### Debug 展示与刷新

Debug 面板展示运行状态、解析后的模型过程、完整原始 JSONL、stderr、prompt 和 report。面板打开后每秒重新调用现有 `getWatchNewsDebugRun()`；关闭面板或 controller 停用时停止定时器。刷新过程中保持当前股票筛选，不新增 IPC 推送通道和后台模块。

### 单股结果反馈

单股“最新消息”分析完成后重新读取该股票的消息历史，并自动打开历史消息面板。存在消息时直接展示模型输出；没有消息时保留状态栏的明确结果，不打开空白历史窗口。批量持仓股分析维持现有交互。

## 错误处理

- Debug 轮询失败时在盯盘状态栏展示错误并停止本轮刷新，后续定时周期仍可重试。
- 模型失败时 Debug 状态显示失败，并同时展示 `meta.errorMessage`、原始 JSONL 和 stderr。
- 模型仍在运行时明确显示“运行中”，避免把尚未生成 `report.md` 误判为无输出。

## 测试

- Provider 测试覆盖运行中、成功、失败状态推断及原始 JSONL 返回。
- Renderer 测试覆盖 Debug 打开后的定时刷新和关闭后停止刷新。
- Renderer 测试覆盖单股分析成功后自动打开消息历史并展示消息内容。
- 执行全量单元测试、类型检查和生产构建。
