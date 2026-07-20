# DeepSeek 思考模式设置设计

## 目标

DeepSeek 的每次对话补全请求都显式启用思考模式，并允许用户在模型服务设置中选择思考强度。默认强度为 `high`，可选值严格限制为 `high` 或 `max`。

## 配置契约

- 在共享类型中增加 `DeepSeekReasoningEffort = "high" | "max"`。
- `AppConfig` 增加可选字段 `deepSeekReasoningEffort`，用于兼容旧配置。
- `ModelProviderSettings` 增加必填字段 `deepSeekReasoningEffort`。
- 旧配置缺少该字段时由 `ConfigStore` 补为 `high`。
- 保存时拒绝 `high`、`max` 以外的值，避免 UI、IPC 或磁盘数据绕过约束。

## 设置界面

DeepSeek 设置区域增加“思考强度”下拉框：

- `high`：默认，常规高强度推理。
- `max`：最高强度推理，耗时和资源消耗通常更高。

不展示 `low`、`medium` 或 `xhigh`，因为 DeepSeek 当前会将其映射到 `high` 或 `max`，展示这些档位会使界面表达与实际行为不一致。

## 请求链路

`ModelProviderManager` 在任务启动时读取完整模型设置，并生成不可变任务快照。`main/index.ts` 创建 `DeepSeekAgentRunner` 时传入快照中的思考强度。Runner 在每一次 `/chat/completions` 请求中显式加入：

```json
{
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

工具调用产生的后续请求使用同一 Runner 和同一快照，因此开关和强度在整个任务中保持一致。修改设置只影响之后启动的调研或消息分析任务。

## 错误处理

- Renderer 使用固定下拉框，正常交互不会产生无效值。
- IPC 仍将输入视为不可信数据，由共享归一化逻辑校验。
- 磁盘中的未知值回退为默认 `high`，保证旧版本或人工编辑配置后应用可启动；保存接口中的未知值则明确报错。

## 测试

- 配置测试：默认值、旧配置迁移、持久化和无效值校验。
- IPC 测试：读取与保存包含思考强度。
- Renderer 测试：存在下拉框、加载当前值并提交修改值。
- Runner 测试：首轮及工具调用后续轮请求都包含显式 `thinking.enabled` 和所选 `reasoning_effort`。
- 回归验证：类型检查、全量测试和生产构建。

