# 调研实时输出与报告日期修正设计

## 目标

修正调研实时输出中流式 token 被逐个换行、展示区域宽度异常、缺少时间戳和 DeepSeek 推理过程不可见的问题；同时保证调研报告中的报告日期始终等于任务创建时的北京时间日期。

## 问题根因

1. Renderer 当前收到每个 `ResearchProgressEvent` 后都执行 `event.text + "\n"`。DeepSeek SSE 的 `content` 增量通常只有一个字或一个短词，因此每个增量都被强制换行。
2. 当前输出边界只有字符串，无法区分状态消息、推理增量和最终回答增量，Renderer 无法正确决定何时加标签、时间戳或换行。
3. `DeepSeekAgentRunner` 只把 `reasoning_content` 转换为“思考中（N 字）”状态，没有把完整推理增量交给上层。
4. 输出面板的 grid item 和 `pre` 缺少完整的宽度收缩约束，长文本和 CJK 最小内容宽度会干扰布局。
5. DeepSeek 调研提示词没有接收任务日期，最终 Markdown 的“报告日期”完全由模型判断。Service 保存报告时也没有校正该元数据。

## 方案选择

采用结构化输出事件，而不是让 provider 预先拼接面向 UI 的字符串。

未采用的方案：

- 只去掉 Renderer 追加的换行：可以修复竖排，但无法可靠区分状态、推理和回答，也无法合理添加时间戳。
- 由 DeepSeek provider 拼接时间戳和标签：会把展示策略耦合到 provider，Codex 与后续模型需要重复实现。

## 数据结构

Provider 边界新增统一输出事件：

```ts
interface ResearchProviderOutputEvent {
  kind: "status" | "reasoning" | "answer";
  text: string;
  mode: "line" | "stream";
}
```

- `status + line`：一次完整状态，如开始请求、执行工具、搜索结果数和警告。
- `reasoning + stream`：DeepSeek `reasoning_content` 原始增量。
- `answer + stream`：DeepSeek `content` 原始增量。
- Codex 的可读 JSONL 事件映射成 `status + line`，保持现有筛选行为。

`ResearchService` 接收 provider 事件后生成跨 IPC 的 `ResearchProgressEvent`，附加任务 `recordId` 和 `occurredAt` ISO 时间戳。Provider 不负责本地时间格式和 UI 标签。

## Renderer 展示

Renderer 维护当前流式段类型：

1. 收到 line 事件时，先结束未换行的流式段，再显示 `[HH:mm:ss] [状态] 内容` 并换行。
2. 收到 reasoning/answer stream 的第一个增量或类型发生切换时，先显示 `[HH:mm:ss] [推理] ` 或 `[HH:mm:ss] [回答] `。
3. 后续同类型增量直接原样拼接，不添加额外换行。
4. 模型原始增量中的换行保持不变；不摘要、不省略 `reasoning_content`。
5. 新任务开始时重置流式段状态。

输出面板、滚动容器和 `pre` 都设置 `min-width: 0`、`width: 100%`；`pre` 使用 `white-space: pre-wrap`、`overflow-wrap: anywhere` 和适合中英文的正常换词规则，保证文本利用整个工作区宽度。

## 报告日期

任务创建时的 `createdAt` 是唯一日期来源：

1. `ResearchService` 把 `createdAt` 作为 `researchDate` 传给当前 provider。
2. DeepSeek 和 Codex 提示词都明确给出当前北京时间日期，并要求报告日期使用该值。
3. Provider 成功返回 Markdown 后，`ResearchService` 在写入 `report.md` 和导出 PDF 前归一化第一处“报告日期”字段。
4. 日期格式统一为 `YYYY年M月D日`。模型遗漏字段时，不擅自重排全文；只在存在报告日期字段时替换其值。

提示词减少模型在正文中误判当前时间的概率，Service 归一化则保证报告元数据准确。

## 错误与兼容

- 老 provider 的输出必须显式映射到结构化事件，不保留字符串隐式协议。
- 缺失或无效 `occurredAt` 时 Renderer 使用收到事件时的本地时间，避免输出丢失。
- 完整推理只存在实时输出 DOM 和 DeepSeek 任务内存，不写入最终报告，也不改变报告内容。
- 现有取消、超时、工具调用和任务级 provider 快照保持不变。

## 测试

- DeepSeek Agent 测试验证每个 `reasoning_content` 增量都会以 reasoning 进度事件发出。
- DeepSeek provider 测试验证 reasoning、answer、status 的结构化映射。
- ResearchService 测试验证事件时间戳和报告日期归一化。
- Renderer 测试验证 token 连续拼接、类型切换换行、时间戳和新任务状态重置。
- CSS 结构测试验证输出区域宽度与换行约束。
- 完整测试、类型检查和生产构建作为最终门禁。
