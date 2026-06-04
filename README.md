# A股调研助手

Windows Electron 桌面软件。支持单股深度调研与自定义盯盘脑图。调研功能调用本机已登录的 Codex CLI，并要求 Codex 使用应用内嵌的 `$research-a-share-stock` skill 完成深度调研。盯盘脑图展示股票行情快照和分类平均涨跌幅。

本软件用于研究信息整理，不构成个性化投资建议或买卖指令。

## Windows 前提

1. 安装 Node.js。
2. 安装 Codex CLI：

   ```powershell
   npm install -g @openai/codex
   ```

3. 登录 Codex：

   ```powershell
   codex login
   codex login status
   ```

若 Codex 已安装但 npm 全局目录尚未加入 `PATH`，应用首次检测时会尝试定位 `codex.cmd`，自动追加当前 Windows 用户的 `PATH`，并让本次应用运行立即生效。应用不会修改系统级 `PATH`，也不会读取或复制 Codex credential 文件。

应用已内嵌 `$research-a-share-stock` skill，不需要单独安装。每次调研启动前，应用会在独立任务目录中生成该 skill 的副本，并注入用户保存的最新调研规范。

## 开发

```bash
npm install
npm test
npm run build
npm run dev
```

`npm run dev` 会先构建，再打开 Electron 窗口。

开发与集成测试可使用 fake Codex：

```bash
STOCK_TOOL_CODEX_EXECUTABLE=/absolute/path/to/fake-codex npm run dev
```

该 override 仅从进程环境变量读取，不写入应用配置，也不在界面暴露。

## Windows 打包

```powershell
npm install
npm test
npm run build
npm run dist:win
```

NSIS 安装包输出到 `release/`。

## 首次使用

1. 打开应用。
2. 输入 A 股标的名称。
3. 点击“调研”。
4. 首次使用时选择 PDF 报告目录。
5. 在“实时输出”标签页查看经过筛选的中文调研进展。运行时顶部会固定显示动态 `working` 状态和耗时，只有日志区域自动滚动到最新进展。
6. 完成后在“调研报告”标签页阅读报告，并可打开 PDF。

左侧历史记录可以重新打开已完成报告。若调研失败，界面会显示 Codex CLI 返回的错误；点击失败记录后，可在“调研报告”标签页查看失败原因。若 Markdown 报告已完成但 PDF 导出失败，界面会显示“重新导出 PDF”。

在“调研规范”标签页可以编辑并保存 `stock_research_spec.md`。保存后的内容从下一次调研开始生效。应用内嵌的初始规范会永久保留；点击“恢复初始版本”可以立即将用户规范回滚到内嵌初始文本。

调研报告中的网页来源链接会使用系统默认浏览器打开，应用窗口会保留在当前报告页面。

## 盯盘脑图

点击左侧“盯盘脑图”打开脑图面板。点击“配置脑图”后可以创建根分类。已有节点通过右键菜单增加子分类或股票，并编辑或删除。添加股票时输入股票名称，点击“按名称搜索股票”，再从 A 股候选中选择。

节点图标显示名称、当日走势曲线和实时涨跌幅。走势曲线中间是零轴虚线，高于零轴显示红色，低于零轴显示绿色；右侧涨跌幅数字同样按涨跌显示红色或绿色。鼠标悬停节点时会显示行情摘要：股票节点包含价格和涨跌幅，分类节点包含其下可用股票叶子的平均涨跌幅。脑图打开后优先读取同日本地缓存，隔日再打开会重新拉取新一天数据；运行期间每 15 秒自动刷新并写回当天缓存。左键点击展开状态的分类节点会回缩，回缩后节点右侧紧贴显示一个小加号；再次左键点击会展开。按住脑图展示区域并拖动，可以向任意方向平移。行情拉取失败时显示“暂无行情”，不会使用虚构数据。

行情来自无需密钥的公开行情快照端点，不属于交易所认证行情。本软件不提供交易功能。

## 文件位置

软件根目录下的 `user_data/` 保存用户业务数据：

- `user_data/config.json`
- `user_data/history.json`
- `user_data/stock_research_spec.md`
- `user_data/watch-tree.json`
- `user_data/watch-quotes-cache.json`
- `user_data/runs/<run-id>/report.md`
- `user_data/runs/<run-id>/events.jsonl`
- `user_data/runs/<run-id>/stderr.log`
- `user_data/runs/<run-id>/.agents/skills/research-a-share-stock/`

用户选择的报告目录中保存：

```text
<标的名称>_YYYY-MM-DD_HHmmss.pdf
```

股票名称中的 Windows 非法文件名字符会替换为 `_`。

## 安全边界

- Renderer 启用上下文隔离，禁用 Node.js integration。
- Preload 仅暴露受限 IPC 方法。
- 股票名称只通过 stdin 传给 Codex CLI。
- 内嵌 skill 只复制到当前任务目录，不修改用户全局 Codex skill。
- 报告中的网页链接只允许通过系统默认浏览器打开，不在 Electron 窗口内导航。
- Codex 使用联网搜索、`read-only` sandbox 和非交互审批策略。
- 应用不读取 Codex credential 文件。
