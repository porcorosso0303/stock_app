# A股单标的调研桌面软件设计

## 目标

第一版提供一个运行在 Windows 上的 Electron 桌面软件。用户输入 A 股标的名称，点击“调研”后，软件调用本机已安装并登录的 Codex CLI，要求 Codex 使用应用内嵌的 `$research-a-share-stock` skill 深度调研该股票。界面实时展示经过筛选的中文进展，完成后展示最终报告、生成 PDF，并将记录保存在历史列表中。

软件不直接读取、复制或管理 Codex credential。用户需要预先安装并登录 Codex CLI。

## 第一版范围

包含：

- 输入单一 A 股标的名称并执行调研。
- 使用 `$research-a-share-stock` skill 完成单股深度调研。
- 内嵌 `$research-a-share-stock` skill，永久保留初始 `stock_research_spec.md`，并允许用户编辑、保存或恢复用户副本。
- 实时展示 Codex CLI 输出。
- 展示最终 Markdown 报告。
- 配置 Windows 报告存放目录。
- 将成功报告导出为 PDF。
- 保存并重新打开历史报告。
- 检测 Codex CLI，必要时自动补充当前 Windows 用户的 `PATH`。
- 同一时刻只运行一个调研任务，并允许用户停止任务。

不包含：

- 使用 `$screen-a-share-stocks` 扫描市场或筛选候选股。
- 在软件中安装 Codex CLI。
- 在软件中执行 Codex 登录。
- 直接访问或复制 Codex credential。
- 多任务并行调研。
- 修改内嵌 `$research-a-share-stock` 的 `SKILL.md` 或 agent 配置。

## 技术选型

使用 Electron + TypeScript。首版由 Electron 主进程直接编排 Codex CLI。

未采用的方案：

- 独立 Node Worker：隔离更清晰，但首版会增加进程通信与故障恢复复杂度。
- 本地 HTTP 服务：适合未来支持网页端或任务队列，但对当前单机版本过重。

## 架构

### Renderer

负责界面展示和用户交互：

- 股票名称输入框。
- “调研”或“停止调研”按钮。
- 当前运行状态。
- 历史记录列表。
- 报告目录摘要和“配置报告目录”按钮。
- `调研规范` 标签页：编辑、保存或恢复用户维护的 `stock_research_spec.md`。
- `调研报告` 标签页：渲染最终 Markdown。
- `实时输出` 标签页：持续追加经过筛选的中文进展，只有日志区域自动滚动到最新内容；调研期间在顶部固定展示动态 `working` 状态和耗时。

Renderer 不直接访问 Node.js API。

### Preload

通过 `contextBridge` 向 Renderer 暴露最小 IPC API：

- 获取和设置报告目录。
- 获取历史记录。
- 启动和停止调研。
- 订阅实时输出、状态变化和任务完成事件。
- 读取历史报告。
- 打开历史 PDF。
- 对已完成但 PDF 导出失败的记录重新导出 PDF。
- 重新检测 Codex CLI。
- 获取、保存和恢复用户维护的调研规范。

### Main Process

负责可信操作：

- 检测 Codex CLI 是否可用。
- 在 Windows 上寻找 `codex.cmd` 并修复当前用户 `PATH`。
- 通过 `child_process.spawn()` 启动和终止 Codex CLI。
- 解析 stdout JSONL 事件，将重要中文进展、网页搜索摘要和错误提示发送到 Renderer；忽略程序运行态噪声。
- 保存配置和历史记录。
- 永久保留内嵌初始调研规范；首次运行或用户点击“恢复初始版本”时，用该文本覆盖用户副本。
- 每次任务启动前，将内嵌 skill 和用户最新规范复制到任务目录 `.agents/skills/research-a-share-stock/`。
- 读取 Codex 最终 Markdown 回复。
- 使用隐藏窗口将 Markdown 报告渲染为 HTML，再调用 `webContents.printToPDF()` 导出 PDF。
- 打开 PDF 文件。
- 将报告中的 `http` 和 `https` 来源链接交给系统默认浏览器打开，并阻止主窗口离开应用页面。

## Codex CLI 调用

使用已登录的本机 Codex CLI：

```bash
codex --search -s read-only -a never exec --json --skip-git-repo-check -o report.md -
```

固定 prompt 包含：

- 明确要求使用 `$research-a-share-stock` skill。
- 明确要求使用当前任务目录 `.agents/skills/research-a-share-stock/` 中的副本，并先读取其中的 `references/stock_research_spec.md`。
- 明确指定用户输入的股票名称。
- 明确要求完成单只 A 股的深度调研。
- 明确要求最终回复为完整 Markdown 报告。
- 不允许修改任何项目或用户文件。

参数意图：

- `exec`：以非交互模式运行，适合桌面端编排。
- `--search`：允许调研使用实时网页搜索。该参数是 Codex 根级参数，放在 `exec` 前。
- `--json`：stdout 输出 JSONL 事件，供界面实时展示。
- `-s read-only`：限制模型生成的 shell 操作为只读。该参数是 Codex 根级参数，放在 `exec` 前。
- `-a never`：不弹出 CLI 交互审批，失败直接返回给模型。该参数是 Codex 根级参数，放在 `exec` 前。
- `--skip-git-repo-check`：允许在应用创建的非 Git 任务目录内运行。
- `-o report.md`：在任务目录中单独输出最终回复，避免从过程事件中猜测报告正文，并避免将动态路径传入 Windows wrapper。
- `-`：从 stdin 读取 prompt，避免股票名称引发命令行转义问题。

应用自身可写用户选择的报告目录和 Electron 用户数据目录。Codex 子进程不获得写文件权限。

每次任务在独立目录中运行。应用启动 Codex 前，将内嵌 `$research-a-share-stock` 复制到任务目录的 `.agents/skills/research-a-share-stock/`，并使用用户保存的最新 `stock_research_spec.md` 覆盖默认 reference。Codex 按 repo 级 skill 规则发现该任务副本，不依赖用户全局 skill 安装。

## Windows Codex CLI 检测和 PATH 修复

应用启动时先执行 `codex --version`。

若命令不可用：

1. 扫描常见 npm 全局目录和用户目录，寻找 `codex.cmd`。
2. 若找到，读取当前 Windows 用户的 `PATH`。
3. 仅在目录不存在时追加该目录，避免重复项。
4. 使用 Windows 用户级环境变量更新方式写入 `PATH`，不请求管理员权限。
5. 同步更新当前 Electron 应用进程的 `PATH`，使本次运行立即生效。
6. 再次执行 `codex --version` 验证。

若仍未找到，界面提示用户安装 Codex CLI，并提供“重新检测”按钮。

应用不自动安装 Codex CLI，不修改系统级 `PATH`。

在 Windows 上，npm 全局安装通常会暴露 `codex.cmd` wrapper。任务启动时优先解析并直接执行底层 `codex.exe`。若只能使用 `codex.cmd`，则显式调用 `ComSpec` 执行 wrapper，并对固定参数和应用生成的文件路径做 Windows quoting。股票名称始终仅通过 stdin 传递，不进入命令行。

## 界面

主窗口采用左右布局。

左侧：

- 股票名称输入框。
- 主操作按钮。
- 运行状态。
- 按时间倒序排列的历史记录列表。

右侧：

- 顶部工具栏：报告目录摘要和“配置报告目录”按钮。
- `调研报告` 标签页。
- `实时输出` 标签页。
- `调研规范` 标签页。

点击历史记录后，在报告标签页中重新展示对应 Markdown，并允许打开 PDF。报告中的网页来源链接使用系统默认浏览器打开，不覆盖应用页面。调研失败的记录在报告标签页中展示失败原因。PDF 导出失败的记录提供“重新导出 PDF”操作。用户在调研规范标签页中保存或恢复的修改从下一次调研开始生效。

## 调研数据流

1. 用户输入股票名称并点击“调研”。
2. 应用校验名称非空。
3. 若尚未设置报告目录，弹出 Windows 目录选择框。用户取消则不启动任务。
4. 应用确认 Codex CLI 可用。
5. 应用创建历史记录，状态为“运行中”。
6. 应用将内嵌 skill 和用户最新调研规范复制到当前任务目录 `.agents/skills/research-a-share-stock/`。
7. 主进程启动 Codex CLI 子进程，并将固定 prompt 写入 stdin。
8. 主进程逐行解析 stdout JSONL，将经过筛选的中文进展实时发送到 Renderer，同时保留完整原始日志。
9. Codex 成功结束后，主进程读取 `-o` 生成的最终 Markdown。
10. 应用保存 Markdown、原始日志和历史元数据。
11. 应用将 Markdown 渲染为 HTML 并导出 PDF。
12. Renderer 切换到报告标签页，展示最终 Markdown。

同一时刻只允许一个任务。任务运行时主按钮变为“停止调研”。

## 数据存储

应用在 Electron `app.getPath('userData')` 下保存：

- `config.json`：报告目录等应用设置。
- `history.json`：历史记录索引。
- `stock_research_spec.md`：用户维护的调研规范，首次运行或恢复初始版本时从内嵌初始文本写入。
- `runs/<run-id>/report.md`：最终 Markdown。
- `runs/<run-id>/events.jsonl`：原始 Codex JSONL 输出。
- `runs/<run-id>/stderr.log`：CLI 标准错误输出。
- `runs/<run-id>/.agents/skills/research-a-share-stock/`：当前任务使用的 skill 副本。

用户选择的报告目录保存 PDF：

```text
<标的名称>_YYYY-MM-DD_HHmmss.pdf
```

股票名称中的 Windows 非法文件名字符替换为 `_`。增加时间可避免同一标的同一天重复调研时覆盖已有文件。

历史记录至少包含：

- `id`
- `stockName`
- `createdAt`
- `updatedAt`
- `status`
- `reportMarkdownPath`
- `eventsPath`
- `stderrPath`
- `pdfPath`
- `errorMessage`

状态至少包含：

- `running`
- `completed`
- `completed_pdf_failed`
- `failed`
- `cancelled`

## 错误处理

- 未安装 Codex CLI：提示安装并允许重新检测。
- 已安装但不可用或未登录：保留 CLI 错误信息，提示用户在终端执行 `codex login` 后重新检测。
- 找到 `codex.cmd` 但不在 `PATH`：自动补充当前用户 `PATH` 并立即验证。
- 内嵌 skill 资产缺失：任务启动失败并显示文件错误，视为应用安装损坏。
- 用户保存空调研规范：拒绝保存并提示“调研规范不能为空”。
- CLI 执行失败：保留实时日志和历史记录，将记录标记为 `failed`，不生成 PDF，并在任务状态和失败记录详情中展示 CLI 错误。
- JSONL 单行解析失败：保留原始行但不显示给用户，不立即中止任务。
- 联网失败：保留 Codex 返回的错误和日志，将记录标记为 `failed`。
- PDF 导出失败：保留 Markdown 和历史记录，将记录标记为 `completed_pdf_failed`，允许重新导出。
- 用户停止：终止子进程，将记录标记为 `cancelled`。
- 用户未选择报告目录：不启动任务。

## 安全边界

- Renderer 启用上下文隔离，不启用 Node.js integration。
- IPC 参数在 Main Process 中再次校验。
- 股票名称通过 stdin 进入 Codex，不拼接 shell 字符串。
- 每次调研使用任务目录中的 skill 副本，不修改用户全局 Codex skill。
- 报告中的 `http` 和 `https` 链接交给系统默认浏览器打开；其他导航协议被阻止。
- 优先使用 `spawn()` 直接执行 `codex.exe` 且禁用 shell。仅在 Windows 上只能找到 `codex.cmd` 时显式调用 `ComSpec`，并使用经过测试的 quoting；股票名称始终只通过 stdin 传递。
- Codex 使用 `read-only` sandbox。
- 应用不读取 credential 文件。
- 报告 HTML 渲染时执行 Markdown 转义和消毒，不允许注入脚本。

## 测试

### 单元测试

- 股票名称校验。
- Windows 文件名清理。
- PDF 文件名生成。
- JSONL 解析和可读事件提取。
- 配置读写。
- 历史记录读写和状态变更。
- Windows `PATH` 去重和追加逻辑。

### 集成测试

使用假的 Codex 可执行文件模拟：

- 成功执行、实时 JSONL 输出、最终 Markdown 和 PDF 导出。
- CLI 失败。
- 用户停止。
- 未登录提示。
- JSONL 中包含无法解析的行。
- PDF 导出失败后重新导出。

### Windows 手工验收

- 首次点击调研时选择报告目录。
- 找到但未加入 `PATH` 的 `codex.cmd` 可自动加入当前用户 `PATH`。
- 已登录 Codex CLI 的真实调研。
- 实时输出持续更新。
- 最终 Markdown 报告展示。
- PDF 中文渲染和文件名格式。
- 历史记录重新打开。
- PDF 打开和重新导出。

## 后续扩展

第一版稳定后可考虑：

- 增加 `$screen-a-share-stocks` 市场筛选入口。
- 增加调研队列和并发控制。
- 增加报告搜索和历史筛选。
- 增加自定义调研策略选择。
- 增加 PDF 模板和导出样式配置。
