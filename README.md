# A股调研助手

Windows Electron 桌面软件。输入一个 A 股标的名称后，应用调用本机已登录的 Codex CLI，并要求 Codex 使用 `$research-a-share-stock` skill 完成深度调研。界面实时展示过程输出，保存历史记录，并导出 PDF 报告。

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

4. 确保 Codex 环境中已安装 `$research-a-share-stock` skill。

若 Codex 已安装但 npm 全局目录尚未加入 `PATH`，应用首次检测时会尝试定位 `codex.cmd`，自动追加当前 Windows 用户的 `PATH`，并让本次应用运行立即生效。应用不会修改系统级 `PATH`，也不会读取或复制 Codex credential 文件。

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
5. 在“实时输出”标签页查看 Codex 过程输出。
6. 完成后在“调研报告”标签页阅读报告，并可打开 PDF。

左侧历史记录可以重新打开已完成报告。若 Markdown 报告已完成但 PDF 导出失败，界面会显示“重新导出 PDF”。

## 文件位置

Electron 用户数据目录中保存：

- `config.json`
- `history.json`
- `runs/<run-id>/report.md`
- `runs/<run-id>/events.jsonl`
- `runs/<run-id>/stderr.log`

用户选择的报告目录中保存：

```text
<标的名称>_YYYY-MM-DD_HHmmss.pdf
```

股票名称中的 Windows 非法文件名字符会替换为 `_`。

## 安全边界

- Renderer 启用上下文隔离，禁用 Node.js integration。
- Preload 仅暴露受限 IPC 方法。
- 股票名称只通过 stdin 传给 Codex CLI。
- Codex 使用联网搜索、`read-only` sandbox 和非交互审批策略。
- 应用不读取 Codex credential 文件。
