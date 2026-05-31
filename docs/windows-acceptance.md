# Windows 手工验收清单

## 环境记录

- Windows 版本：
- Node.js 版本：
- Codex CLI 版本：
- 安装包文件名：
- 真实调研标的：
- PDF 文件路径：
- 未通过项：

## 构建

在 Windows PowerShell 中执行：

```powershell
npm install
npm test
npm run build
npm run dist:win
```

确认：

- 所有自动化测试通过。
- `release/` 中生成 NSIS `.exe` 安装包。
- 安装包可完成安装并打开应用。

## Codex CLI 环境

执行：

```powershell
codex --version
codex login status
```

确认已登录。

测试用户级 `PATH` 自动修复：

1. 临时从当前用户 `PATH` 移除 npm 全局目录，但不要卸载 Codex。
2. 启动应用。
3. 点击“重新检测”。
4. 确认应用找到 `codex.cmd`。
5. 确认 npm 全局目录已追加到当前用户 `PATH`。
6. 确认应用本次运行即可使用 Codex，不需要管理员权限。

## 首次调研

1. 清除应用配置，或使用新的 Windows 用户运行应用。
2. 输入一个真实 A 股标的名称。
3. 点击“调研”。
4. 确认应用弹出目录选择框。
5. 取消选择，确认任务不启动。
6. 再次点击“调研”，选择报告目录。
7. 确认任务启动，按钮变为“停止调研”。
8. 切换到“实时输出”，确认 Codex 输出持续追加。
9. 等待任务完成，确认自动切换到“调研报告”。
10. 检查报告包含来源链接和日期。

## PDF

确认：

- PDF 文件名格式为 `<标的名称>_YYYY-MM-DD_HHmmss.pdf`。
- 中文文字显示正常。
- 标题、列表、链接和表格排版可读。
- 点击“打开 PDF”可以调用系统默认 PDF 阅读器。
- 同一标的同一天再次调研时不会覆盖已有 PDF。

测试重新导出：

1. 将目标目录临时设置为不可写目录，或用开发环境模拟 PDF 导出失败。
2. 确认历史状态为“报告完成，PDF 导出失败”。
3. 恢复可写目录。
4. 点击“重新导出 PDF”。
5. 确认 PDF 生成且历史状态更新为“已完成”。

## 历史与取消

确认：

- 历史记录按时间倒序排列。
- 点击历史记录可重新展示 Markdown 报告。
- 运行中点击“停止调研”，状态更新为“已取消”。
- 取消后可以启动新的调研。

## 安全检查

确认：

- 应用没有读取或复制 Codex credential 文件。
- Codex prompt 使用 `$research-a-share-stock` skill。
- Codex CLI 参数包含 `--search`、`-s read-only`、`-a never`。
- 股票名称只通过 stdin 传入 Codex。
- Renderer 启用上下文隔离，禁用 Node.js integration。
