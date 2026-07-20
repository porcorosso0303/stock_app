# 可选择模型服务设计

## 1. 背景与目标

应用当前使用 OpenAI Codex CLI 完成股票调研，以及持仓股消息的捕捉、分析和汇总。为了支持用户选择不同的大模型服务，本次增加 DeepSeek，并为以后增加其他模型服务保留稳定的扩展边界。

本次目标：

- 在 `Setting` 菜单中增加独立的“模型服务”设置窗口。
- 保留现有 OpenAI Codex CLI 能力，并新增 DeepSeek。
- 允许用户设置 DeepSeek API Key、Base URL 和模型名称。
- DeepSeek 缺少内置联网能力，因此使用 Tavily 作为独立的网页搜索与正文提取服务。
- 股票调研和持仓股消息任务都使用任务开始时选中的模型服务。
- 修改设置只影响之后创建的任务，不影响已经在执行的调研或消息分析任务。
- API Key 加密保存在软件根目录下的 `user_data`，不写入普通配置、日志、调试输出和导出数据。

## 2. 非目标

- 本次不统一重写 Codex CLI 与 DeepSeek 的底层调用协议。
- 本次不改变调研报告、历史记录、脑图、行情缓存和持仓股消息的已有数据格式。
- 本次不把 DeepSeek API Key 或 Tavily API Key加入脑图导出包。
- 本次不提供云端同步或多用户凭据管理。
- 本次不引入 OpenAI SDK。DeepSeek 通过现有 Electron 网络基础设施直接调用兼容接口。

## 3. 官方协议依据

DeepSeek 实现严格参照官方文档：

- [DeepSeek API 文档](https://api-docs.deepseek.com/zh-cn/)
- [模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [工具调用](https://api-docs.deepseek.com/zh-cn/guides/tool_calls)
- [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
- [创建聊天补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)

Tavily 实现参照：

- [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)

截至 2026-07-20，DeepSeek 默认 Base URL 为 `https://api.deepseek.com`。设置界面提供当前模型预设 `deepseek-v4-pro` 和 `deepseek-v4-flash`，同时允许用户输入服务端支持的其他模型名称，避免客户端模型列表过期后阻止使用。

## 4. 总体架构

### 4.1 保留任务级业务 Provider

股票调研和持仓股消息的输入、输出和生命周期不同，继续保留两类业务接口：

- `ResearchProvider`：接收调研任务，输出调研报告及运行日志。
- `WatchNewsAnalysisProvider`：接收股票和已有消息，输出统一的 `WatchNewsDraft[]`。

模型选择层不向渲染层暴露 DeepSeek 或 Codex 的协议细节。新增 `ModelProviderManager`，根据当前配置为新任务解析一组业务 Provider：

```text
Renderer
  -> ResearchService
      -> ModelProviderManager.resolveResearchProvider()
          -> CodexCliResearchProvider
          -> DeepSeekResearchProvider

  -> WatchNewsService
      -> ModelProviderManager.resolveWatchNewsProvider()
          -> CodexWatchNewsAnalysisProvider
          -> DeepSeekWatchNewsAnalysisProvider
```

不把 Codex CLI 和 DeepSeek 强行抽象成统一的原始 LLM Client。Codex CLI 本身是带工具、技能和运行环境的代理；DeepSeek API 是模型推理接口，需要应用自己执行联网工具。业务 Provider 是两者共同且稳定的边界。

### 4.2 Provider Bundle

同一种模型服务提供股票调研和持仓股消息两类实现：

```ts
type ModelProviderId = "codex-cli" | "deepseek";

interface ModelProviderBundle {
  readonly id: ModelProviderId;
  createResearchProvider(): ResearchProvider;
  createWatchNewsProvider(): WatchNewsAnalysisProvider;
}
```

`ModelProviderManager` 负责读取非敏感配置、解密所需凭据、验证设置，并构造不可变的任务 Provider。业务 Service 不读取全局模型配置，也不直接持有配置存储。

### 4.3 任务快照

模型配置必须在任务开始时解析一次：

- 调研任务在 `ResearchService.start()` 开始时解析一次 Provider，并保存在活动任务记录中。
- 一次“持仓股消息”批量任务在批次开始时解析一次 Provider；该批次内所有股票使用同一个快照。
- 单只股票右键触发的新消息任务同样在开始时获取快照。
- 保存模型设置只修改配置文件，不替换活动任务持有的 Provider，不取消、不重启任务。
- 取消调研任务时，调用活动任务快照中的 Provider，而不是重新读取当前设置。

因此，用户在任务运行期间从 Codex 切换到 DeepSeek，当前任务继续使用 Codex，之后创建的任务使用 DeepSeek。

## 5. 配置与密钥

### 5.1 非敏感配置

`user_data/config.json` 增加：

```ts
interface ModelProviderConfig {
  modelProviderId: "codex-cli" | "deepseek";
  deepSeekBaseUrl: string;
  deepSeekModel: string;
}
```

默认值：

- `modelProviderId`: `codex-cli`
- `deepSeekBaseUrl`: `https://api.deepseek.com`
- `deepSeekModel`: `deepseek-v4-pro`

旧配置缺少字段时在读取阶段使用默认值，现有用户不需要迁移操作。

### 5.2 敏感配置

`user_data/model-secrets.json` 只保存 Electron `safeStorage.encryptString()` 产生的密文：

```json
{
  "version": 1,
  "deepSeekApiKey": "<base64 encrypted value>",
  "tavilyApiKey": "<base64 encrypted value>"
}
```

安全要求：

- 明文 API Key 只存在于保存调用和任务快照构造过程的内存中。
- 渲染进程读取设置时只得到 `hasDeepSeekApiKey`、`hasTavilyApiKey`，不返回已保存的明文或密文。
- 输入框默认空白；“已配置”由状态标签表示。用户输入新值才覆盖旧值。
- 提供分别清除 DeepSeek 和 Tavily Key 的操作。
- 日志和调试窗口禁止输出 `Authorization`、API Key、完整请求头以及包含密钥的 URL。
- 脑图导出和其他用户数据导出不包含 `model-secrets.json`。
- `safeStorage` 不可用时拒绝保存密钥并给出明确错误，不回退到明文。

## 6. 设置界面

`Setting` 菜单新增“模型服务”，点击后打开独立模态窗口，保持与现有“数据源”“持仓股消息”设置相同的菜单模式。

字段：

- 模型服务：`OpenAI Codex` / `DeepSeek`。
- Codex 区域：显示 CLI 是否安装、是否登录以及重新检测按钮。
- DeepSeek Base URL：默认 `https://api.deepseek.com`。
- DeepSeek 模型：可编辑下拉框，提供 `deepseek-v4-pro`、`deepseek-v4-flash` 预设。
- DeepSeek API Key：密码输入框、已配置状态、更新和清除操作。
- Tavily API Key：密码输入框、已配置状态、更新和清除操作。

校验：

- DeepSeek Base URL 必须是合法 URL。
- 除 `localhost` 和 `127.0.0.1` 外必须使用 HTTPS。
- 模型名称不能为空。
- 选择 DeepSeek 时，DeepSeek 和 Tavily Key 都必须已经配置或在本次保存中提供。
- 保存失败时窗口保持打开并展示具体错误。

新任务启动前再次做服务端校验，避免配置文件被外部修改后产生不明确失败。

## 7. DeepSeek Agent

### 7.1 API 请求

DeepSeek Agent 直接调用：

```text
POST {baseUrl}/chat/completions
Authorization: Bearer <DeepSeek API Key>
Content-Type: application/json
```

请求使用流式响应，并包含：

- `model`
- `messages`
- `stream: true`
- `tools`
- `tool_choice: "auto"`

实现需要支持官方思考模式与工具调用组合。模型返回工具调用时，追加 assistant 消息必须保留 `reasoning_content`、`content` 和 `tool_calls`，之后再追加对应的 tool 消息。遗漏 `reasoning_content` 会破坏思考模式下的后续请求。

### 7.2 SSE 解析

流式解析器按 SSE 事件处理：

- 忽略空行和注释。
- 合并分段 `content`、`reasoning_content`、`tool_calls[].function.arguments`。
- 收到 `[DONE]` 结束当前补全。
- 非 2xx 响应先解析 DeepSeek 错误体，再映射成中文错误。
- 用户取消时中止当前 HTTP 请求和后续工具调用。

思考内容用于调试进度，不直接写入最终报告或持仓股消息。

### 7.3 工具循环

DeepSeek 可调用两个应用工具：

```text
web_search(query, topic?, days?, start_date?, end_date?, include_domains?, exclude_domains?)
web_extract(urls[])
```

每次工具调用执行以下检查：

- JSON 参数可解析并符合运行时结构。
- URL 只允许 `http:` 和 `https:`。
- 限制单次 URL 数量、结果数量和正文长度。
- 限制单任务工具轮数，防止无限循环。
- 网络请求有独立超时并响应任务取消信号。
- 工具结果作为结构化 JSON 返回模型，不拼接成未标记的系统指令。

## 8. Tavily 数据适配

`TavilyWebTools` 是与模型无关的网页检索适配层：

- `/search` 用于搜索公告、公司官网、投资者问答、媒体报道和论坛线索。
- `/extract` 用于提取指定网页正文。
- 支持 `general`、`news`、`finance` 主题以及日期和域名过滤。
- API 响应统一转换成应用内部结果，不向上层泄漏 Tavily 原始字段变化。
- 请求使用 Bearer 鉴权，密钥不进入查询参数。

消息任务的来源要求通过提示词和搜索域过滤共同实现。雪球等论坛只作为线索来源，模型应继续检索公告、交易所互动平台、公司官网或权威媒体进行交叉验证。

## 9. 股票调研接入

### 9.1 Codex 路径

保持当前 `CodexCliResearchProvider`、调研技能准备、运行日志、取消、报告历史和 PDF 生成逻辑不变。

### 9.2 DeepSeek 路径

`DeepSeekResearchProvider`：

1. 读取现有用户调研要求。
2. 构造不依赖 Codex 技能文件的调研工作流提示词。
3. 通过 DeepSeek Agent 和 Tavily 搜集公告、财报、官网、互动问答、媒体及行业资料。
4. 要求模型对来源、日期、事实和推断进行区分。
5. 输出与现有流程兼容的 Markdown 报告。
6. 将流式内容、搜索动作和错误通过现有 `onOutput` 通道传给运行界面。

Provider 返回值继续遵守 `ResearchProviderResult`，因此报告保存、历史记录、取消和 PDF 导出不因模型变化而修改。

## 10. 持仓股消息接入

消息编排继续承担：

- 东方财富公告的确定性预取。
- 通常 48 小时、首次补抓 7 天的时间范围。
- 历史消息去重。
- 统一 `WatchNewsDraft[]` 输出。
- 重要公告在模型失败时的降级保存。
- 单只股票 3 分钟无进度超时、12 分钟最大运行时间。

模型相关部分通过可替换分析执行器完成：

- Codex 继续使用现有 CLI 工具和提示词。
- DeepSeek 使用 Tavily 搜索其余来源并完成可信度判断、影响分析和结构化汇总。
- 两种实现都必须返回相同的消息草稿结构，上层消息存储、未读标记和历史窗口不感知模型类型。

一次持仓股批量分析只解析一次 Provider 快照，然后并发处理该批次股票。标签切换、脑图刷新和之后修改模型设置都不影响正在运行的批次。

## 11. 错误处理与降级

常见错误映射：

- DeepSeek 401/403：API Key 无效或无权限。
- DeepSeek 402 或余额相关错误：账户余额不足。
- DeepSeek 模型不存在：提示检查模型名称和服务端支持情况。
- DeepSeek 请求超时或连接失败：提示网络或 Base URL 问题。
- Tavily 401/403：Tavily API Key 无效或无权限。
- Tavily 配额错误：提示检索额度不足。
- 所有网页检索均失败：DeepSeek 调研任务失败，不生成缺少依据的报告。
- 持仓股消息中模型或 Tavily 失败，但已经预取到新的重要公司公告：按现有降级规则保存公告，并在调试窗口显示降级原因。

所有错误必须包含 Provider 名称和可操作原因，但不得包含密钥、认证头或完整敏感请求。

## 12. 调试与可观测性

调研运行输出和持仓股消息 Debug 窗口显示：

- 当前任务使用的 Provider 和模型。
- DeepSeek 请求开始、响应状态和耗时。
- 模型思考进度摘要或字符进度，不把内部思考作为业务结论。
- 工具名称、检索关键词、域名范围、结果数量和耗时。
- 重试、超时、取消和降级原因。
- 最终结构化结果数量。

输出必须经过统一脱敏，删除认证头及已配置密钥的任何意外出现。

## 13. 数据兼容

- 旧 `config.json` 缺少模型字段时默认使用 `codex-cli`。
- 原有 `researchProviderId` 若存在，读取时兼容映射到新字段，保存时使用新的 `modelProviderId`。
- 调研历史、报告、脑图、行情缓存和持仓股消息文件不做格式迁移。
- 模型设置与活动标签、脑图行情日期等运行态状态彼此独立。

## 14. 测试策略

### 14.1 单元测试

- 配置默认值、旧字段兼容和 URL 校验。
- `safeStorage` 加密、解密、更新、清除和明文不落盘。
- IPC 只返回密钥配置状态。
- Tavily Search/Extract 请求参数、日期/域名过滤、超时和错误映射。
- DeepSeek SSE 合并、错误体、思考内容、工具参数拼接和 `[DONE]`。
- 思考模式下工具轮次完整回放 `reasoning_content`。
- 工具参数校验、轮数限制、取消和内容长度限制。
- 调研与消息 Service 在任务开始时解析一次 Provider。
- 设置变更不影响进行中的任务，后续任务使用新 Provider。
- 消息预取公告的失败降级和去重。

### 14.2 集成与界面测试

- `Setting > 模型服务` 打开独立窗口。
- Codex 状态展示和重新检测。
- DeepSeek 配置保存、更新、清除、掩码和校验。
- 选择 DeepSeek 后调研与消息任务均走 DeepSeek Provider。
- 缺少任一 API Key 时新任务显示明确错误。
- 修改设置后活动任务不被取消或切换。

### 14.3 回归验证

- 全量 Vitest。
- TypeScript 类型检查和生产构建。
- Windows `win-unpacked` 部署。
- 人工验证 Codex 原路径、DeepSeek 调研、单股消息、持仓股批量消息、任务中途切换设置和密钥不泄漏。

## 15. 文档维护

实现完成后同步更新 `docs/architecture.md`：

- 模型服务设置与密钥存储。
- `ModelProviderManager` 的任务快照规则。
- Codex 和 DeepSeek 的调研 Provider。
- DeepSeek Agent 与 Tavily 工具边界。
- 持仓股消息的公共编排和模型适配。
- IPC、用户数据文件和错误处理。

后续新增模型服务时，应优先增加新的 Provider Bundle；只有业务输入输出契约确实变化时，才修改上层 Service。
