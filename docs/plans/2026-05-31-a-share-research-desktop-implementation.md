# A股单标的调研桌面软件 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个 Windows Electron 桌面程序，调用本机已登录的 Codex CLI 和 `$research-a-share-stock` skill 调研单只 A 股，实时显示过程输出，保存历史记录，并导出 PDF。

**Architecture:** 使用 Electron + TypeScript。Renderer 负责单页界面，Preload 只暴露受限 IPC，Main Process 负责 Codex CLI 检测、Windows 用户 `PATH` 修复、子进程编排、持久化和 PDF 导出。纯逻辑与 Electron API 解耦，便于在 Linux 开发环境中通过 Vitest 验证，并在 Windows 上完成最终验收。

**Tech Stack:** Electron、TypeScript、Vite、Vitest、`markdown-it`、Electron Builder、Node.js `child_process` 和 `fs/promises`

---

## 实施约束

- 开始实现前使用 `superpowers:using-git-worktrees` 创建独立 worktree。
- 每个功能先按 `superpowers:test-driven-development` 写失败测试，再写最小实现。
- 完成后按 `superpowers:verification-before-completion` 运行完整验证。
- Renderer 必须保持 `contextIsolation: true`、`nodeIntegration: false`。
- 股票名称只通过 stdin 传给 Codex，不得进入 shell 命令字符串。
- 子进程在任务目录运行，Codex 输出文件固定为 `report.md`。
- Windows 上优先直接执行 `codex.exe`；只有找到 `codex.cmd` 且无法解析原生入口时才使用显式 `ComSpec` 回退。

## Task 1: 初始化 Electron TypeScript 工程

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `.gitignore`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.ts`
- Create: `src/renderer/styles.css`

**Step 1: 初始化 npm 并安装依赖**

Run:

```bash
npm init -y
npm install markdown-it
npm install --save-dev electron electron-builder typescript vite vitest @types/node @types/markdown-it
```

Expected: 生成 `package-lock.json`，安装命令成功。

**Step 2: 配置构建脚本**

在 `package.json` 中设置：

```json
{
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "npm run build && electron .",
    "build": "npm run typecheck && npm run build:node && npm run build:renderer",
    "build:node": "tsc -p tsconfig.node.json",
    "build:renderer": "vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist:win": "npm run build && electron-builder --win nsis"
  },
  "build": {
    "appId": "com.local.ashareresearch",
    "productName": "A股调研助手",
    "directories": { "output": "release" },
    "files": ["dist/**/*", "package.json"],
    "win": { "target": "nsis" },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
  }
}
```

配置 TypeScript：

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vite.config.ts"]
}
```

```json
// tsconfig.node.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts"]
}
```

配置 Vite 将 renderer 输出到 `dist/renderer`。

**Step 3: 写最小 Electron 壳**

`src/main/index.ts` 创建 `BrowserWindow`，加载 `dist/renderer/index.html`，指定 `dist/preload/index.js`，并明确：

```ts
webPreferences: {
  preload: join(__dirname, "../preload/index.js"),
  contextIsolation: true,
  nodeIntegration: false
}
```

Renderer 暂时只显示标题“A股调研助手”。

**Step 4: 构建验证**

Run:

```bash
npm run build
```

Expected: PASS，生成 `dist/main/index.js`、`dist/preload/index.js` 和 `dist/renderer/index.html`。

**Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts .gitignore src
git commit -m "chore: scaffold Electron TypeScript app"
```

## Task 2: 定义共享类型和输入辅助函数

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/main/stock-name.ts`
- Create: `tests/main/stock-name.test.ts`

**Step 1: 写失败测试**

覆盖：

```ts
expect(validateStockName(" 贵州茅台 ")).toBe("贵州茅台");
expect(() => validateStockName("   ")).toThrow("请输入A股标的名称");
expect(sanitizeWindowsFilePart('A/B:C*D?"E<F>G|')).toBe("A_B_C_D__E_F_G_");
expect(buildPdfFileName("贵州茅台", new Date("2026-05-31T06:30:25Z")))
  .toMatch(/^贵州茅台_2026-05-31_\d{6}\.pdf$/);
```

为时区稳定性，让 `buildPdfFileName()` 接受格式化器或在测试中使用本地构造时间。

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/main/stock-name.test.ts
```

Expected: FAIL，模块尚不存在。

**Step 3: 写最小实现**

实现：

- `validateStockName(value)`：trim 后非空，限制最大长度 80。
- `sanitizeWindowsFilePart(value)`：替换 `<>:"/\\|?*`、控制字符和末尾点号或空格。
- `buildPdfFileName(stockName, date)`：输出 `<标的>_YYYY-MM-DD_HHmmss.pdf`。

在 `src/shared/types.ts` 定义：

```ts
export type ResearchStatus =
  | "running"
  | "completed"
  | "completed_pdf_failed"
  | "failed"
  | "cancelled";

export interface ResearchRecord {
  id: string;
  stockName: string;
  createdAt: string;
  updatedAt: string;
  status: ResearchStatus;
  reportMarkdownPath: string;
  eventsPath: string;
  stderrPath: string;
  pdfPath?: string;
  errorMessage?: string;
}
```

同时定义配置、Codex 检测结果和 Renderer IPC 使用的数据结构。

**Step 4: 运行测试**

Run:

```bash
npx vitest run tests/main/stock-name.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/shared/types.ts src/main/stock-name.ts tests/main/stock-name.test.ts
git commit -m "feat: add stock input and PDF filename helpers"
```

## Task 3: 实现配置和历史记录持久化

**Files:**
- Create: `src/main/json-store.ts`
- Create: `src/main/config-store.ts`
- Create: `src/main/history-store.ts`
- Create: `tests/main/config-store.test.ts`
- Create: `tests/main/history-store.test.ts`

**Step 1: 写失败测试**

使用 Vitest 的临时目录。覆盖：

- 配置文件不存在时返回 `{}`。
- `setReportDirectory()` 保存目录，重新实例化 store 后仍能读取。
- 历史记录按 `createdAt` 倒序返回。
- 更新记录状态时保留其他字段。
- 损坏 JSON 文件抛出带文件路径的明确错误。

示例：

```ts
const store = new ConfigStore(join(tempDir, "config.json"));
await store.setReportDirectory("C:\\reports");
expect(await new ConfigStore(join(tempDir, "config.json")).get())
  .toEqual({ reportDirectory: "C:\\reports" });
```

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/main/config-store.test.ts tests/main/history-store.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

实现一个复用的 JSON store：

- 写入时先写同目录临时文件，再 `rename()`，降低进程中断造成的损坏概率。
- 创建父目录。
- 使用 UTF-8。

`HistoryStore` 提供：

```ts
list(): Promise<ResearchRecord[]>
get(id: string): Promise<ResearchRecord | undefined>
create(record: ResearchRecord): Promise<void>
update(id: string, patch: Partial<ResearchRecord>): Promise<ResearchRecord>
```

**Step 4: 运行测试**

Run:

```bash
npx vitest run tests/main/config-store.test.ts tests/main/history-store.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/main/json-store.ts src/main/config-store.ts src/main/history-store.ts tests/main
git commit -m "feat: persist app configuration and research history"
```

## Task 4: 实现 Windows Codex 检测和用户 PATH 修复

**Files:**
- Create: `src/main/codex-locator.ts`
- Create: `src/main/windows-user-path.ts`
- Create: `tests/main/codex-locator.test.ts`
- Create: `tests/main/windows-user-path.test.ts`

**Step 1: 写失败测试**

将文件系统、平台、环境变量和命令执行器注入 locator，避免测试依赖真实机器。覆盖：

- 当前 `PATH` 中存在 `codex.exe` 时优先返回原生入口。
- 仅存在 `codex.cmd` 时返回 wrapper 入口。
- 从 `%APPDATA%\\npm` 找到 `codex.cmd`。
- 从 npm 包目录找到 `@openai/codex-win32-x64/.../codex.exe` 时优先返回原生入口。
- `appendPathEntry()` 大小写不敏感去重。
- `PowerShellUserPathStore` 使用用户级 `PATH`，不修改系统级环境变量。

关键纯函数：

```ts
expect(appendPathEntry("C:\\A;C:\\B", "c:\\a")).toBe("C:\\A;C:\\B");
expect(appendPathEntry("C:\\A", "C:\\B")).toBe("C:\\A;C:\\B");
```

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/main/codex-locator.test.ts tests/main/windows-user-path.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

定义：

```ts
export interface CodexLauncher {
  kind: "native" | "cmd-wrapper";
  executablePath: string;
}

export interface CodexEnvironmentStatus {
  available: boolean;
  launcher?: CodexLauncher;
  version?: string;
  loggedIn?: boolean;
  repairedUserPath?: boolean;
  message?: string;
}
```

实现检测流程：

1. 从当前 `PATH` 和 Windows 常见 npm 目录查找入口。
2. 如果找到 npm wrapper，尝试查找相邻 npm 包内的 `codex.exe`。
3. 执行 `--version`。
4. 执行 `login status` 判断是否已登录。
5. 若仅在扫描目录找到入口，使用用户级 PATH store 追加 wrapper 所在目录，并同步修改 `process.env.PATH`。

用户级 PATH 更新通过 `powershell.exe -NoProfile -NonInteractive -Command` 调用：

```powershell
[Environment]::SetEnvironmentVariable('Path', $env:STOCK_TOOL_USER_PATH, 'User')
```

新 PATH 放入子进程环境变量 `STOCK_TOOL_USER_PATH`，不拼接进 PowerShell 脚本文本。

**Step 4: 运行测试**

Run:

```bash
npx vitest run tests/main/codex-locator.test.ts tests/main/windows-user-path.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/main/codex-locator.ts src/main/windows-user-path.ts tests/main
git commit -m "feat: detect Codex CLI and repair Windows user PATH"
```

## Task 5: 构造 Codex Prompt 并解析 JSONL 事件

**Files:**
- Create: `src/main/codex-prompt.ts`
- Create: `src/main/codex-events.ts`
- Create: `tests/main/codex-prompt.test.ts`
- Create: `tests/main/codex-events.test.ts`

**Step 1: 写失败测试**

覆盖：

- Prompt 明确包含 `$research-a-share-stock`。
- Prompt 包含输入标的。
- Prompt 明确禁止写文件并要求完整 Markdown 最终报告。
- 分块输入可以正确拼接完整 JSONL 行。
- 无法解析的行保留在原始日志中，但不发送到界面，也不会让 parser 崩溃。
- 常见 Codex JSON 事件提取可读文本；未知事件保留紧凑 JSON。

示例：

```ts
const prompt = buildResearchPrompt("贵州茅台");
expect(prompt).toContain("$research-a-share-stock");
expect(prompt).toContain("贵州茅台");
expect(prompt).toContain("不要修改");
```

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/main/codex-prompt.test.ts tests/main/codex-events.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

实现：

```ts
export const CODEX_EXEC_ARGS = [
  "--search",
  "-s", "read-only",
  "-a", "never",
  "exec",
  "--json",
  "--skip-git-repo-check",
  "-o", "report.md",
  "-"
] as const;
```

实现增量 JSONL parser，输出：

```ts
export interface CodexDisplayEvent {
  raw: string;
  text: string;
  level: "info" | "warning" | "error";
}
```

不要假设只有一种 Codex CLI 事件 schema。优先提取常见文本字段，未知结构退化为紧凑 JSON。

**Step 4: 运行测试**

Run:

```bash
npx vitest run tests/main/codex-prompt.test.ts tests/main/codex-events.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/main/codex-prompt.ts src/main/codex-events.ts tests/main
git commit -m "feat: build stock research prompt and parse Codex events"
```

## Task 6: 实现 Codex 子进程 Runner

**Files:**
- Create: `src/main/codex-runner.ts`
- Create: `tests/fixtures/fake-codex.cjs`
- Create: `tests/main/codex-runner.test.ts`

**Step 1: 写假的 Codex 可执行脚本**

`tests/fixtures/fake-codex.cjs` 根据环境变量支持：

- `success`：分多次输出 JSONL，写 `report.md`，退出码 0。
- `failure`：向 stderr 输出错误，退出码 1。
- `slow`：持续等待，供停止任务测试。
- `invalid-jsonl`：输出一行坏 JSON 后继续成功。

**Step 2: 写失败测试**

覆盖：

- Runner 将 prompt 写入 stdin。
- Runner 固定使用只读 sandbox 参数。
- Runner 实时回调可读事件。
- 成功后返回 `report.md` 内容。
- stderr 保存到 `stderr.log`。
- stdout 原始行保存到 `events.jsonl`。
- `cancel()` 终止运行中任务并返回 cancelled 结果。

**Step 3: 运行测试确认失败**

Run:

```bash
npx vitest run tests/main/codex-runner.test.ts
```

Expected: FAIL。

**Step 4: 写最小实现**

`CodexRunner` 接收 launcher、run directory 和事件回调。原生入口直接：

```ts
spawn(launcher.executablePath, CODEX_EXEC_ARGS, {
  cwd: runDirectory,
  shell: false,
  windowsHide: true
});
```

`codex.cmd` 回退使用单独 helper 构造：

```ts
spawn(process.env.ComSpec ?? "cmd.exe", [
  "/d", "/s", "/c",
  buildTrustedCmdWrapperInvocation(launcher.executablePath, CODEX_EXEC_ARGS)
], {
  cwd: runDirectory,
  shell: false,
  windowsHide: true
});
```

`buildTrustedCmdWrapperInvocation()` 只接收 locator 找到的 wrapper 路径和代码内固定参数。股票名称绝不传给该 helper。

测试通过 `spawnFactory` 注入 `process.execPath tests/fixtures/fake-codex.cjs`，使 Linux 环境也可覆盖 runner 生命周期。

**Step 5: 运行测试**

Run:

```bash
npx vitest run tests/main/codex-runner.test.ts
```

Expected: PASS。

**Step 6: Commit**

```bash
git add src/main/codex-runner.ts tests/fixtures/fake-codex.cjs tests/main/codex-runner.test.ts
git commit -m "feat: stream and cancel Codex research runs"
```

## Task 7: 实现 Markdown 渲染和 PDF 导出

**Files:**
- Create: `src/shared/render-markdown.ts`
- Create: `src/main/pdf-exporter.ts`
- Create: `tests/shared/render-markdown.test.ts`
- Create: `tests/main/pdf-exporter.test.ts`

**Step 1: 写失败测试**

覆盖：

- 标题、列表和链接可渲染。
- Markdown 中的原始 `<script>` 不会执行或进入输出。
- `javascript:` 链接不可进入输出。
- PDF exporter 使用 A4、`printBackground: true`。
- exporter 将 PDF buffer 写入目标路径。

示例：

```ts
expect(renderMarkdown("# 标题")).toContain("<h1>标题</h1>");
expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
```

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/shared/render-markdown.test.ts tests/main/pdf-exporter.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

使用 `markdown-it` 并禁用原始 HTML：

```ts
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false
});
```

PDF exporter：

1. 生成带 UTF-8 meta、中文系统字体 fallback 和打印样式的完整 HTML。
2. 创建不可见 `BrowserWindow({ show: false })`。
3. 加载 `data:text/html;charset=utf-8,...`。
4. 等待 `did-finish-load`。
5. 调用：

```ts
webContents.printToPDF({
  pageSize: "A4",
  printBackground: true
});
```

6. 写入 PDF 文件并销毁窗口。

通过注入 `createWindow` 和 `writeFile` 测试，不在单元测试中启动真实 Electron。

**Step 4: 运行测试**

Run:

```bash
npx vitest run tests/shared/render-markdown.test.ts tests/main/pdf-exporter.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/shared/render-markdown.ts src/main/pdf-exporter.ts tests
git commit -m "feat: render Markdown reports and export PDF"
```

## Task 8: 编排完整调研生命周期

**Files:**
- Create: `src/main/research-service.ts`
- Create: `tests/main/research-service.test.ts`

**Step 1: 写失败测试**

使用假的 locator、runner、stores 和 PDF exporter。覆盖：

- 未配置报告目录时拒绝启动，由调用方触发目录选择。
- Codex 不可用或未登录时返回明确错误。
- 同一时刻只允许一个任务。
- 启动后立即创建 `running` 历史记录。
- 成功后状态改为 `completed` 并保存 PDF 路径。
- PDF 失败后状态为 `completed_pdf_failed`，Markdown 仍可读取。
- CLI 失败状态为 `failed`，不调用 PDF exporter。
- 用户停止后状态为 `cancelled`。
- 重新导出 PDF 可将 `completed_pdf_failed` 改为 `completed`。

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/main/research-service.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

`ResearchService` 提供：

```ts
start(stockName: string): Promise<ResearchRecord>
cancel(): Promise<void>
retryPdfExport(recordId: string): Promise<ResearchRecord>
readReport(recordId: string): Promise<string>
getActiveRecord(): ResearchRecord | undefined
```

run ID 使用 `crypto.randomUUID()`。任务目录：

```text
<userData>/runs/<run-id>/
```

PDF 文件名使用 Task 2 的 helper。通过事件回调将状态和实时输出上送 IPC 层。

**Step 4: 运行测试**

Run:

```bash
npx vitest run tests/main/research-service.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/main/research-service.ts tests/main/research-service.test.ts
git commit -m "feat: orchestrate stock research lifecycle"
```

## Task 9: 接入 Electron IPC、Preload 和应用启动

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/global.d.ts`
- Create: `tests/main/ipc.test.ts`

**Step 1: 写失败测试**

对 IPC handler 注册函数注入假的 `ipcMain`。覆盖：

- 参数在 Main Process 再次校验。
- 设置目录使用 `dialog.showOpenDialog({ properties: ["openDirectory"] })`。
- 用户取消目录选择返回 `undefined`。
- 打开 PDF 时只允许历史记录中已有的 PDF 路径。
- `shell.openPath()` 返回错误字符串时转为失败。
- 启动、停止、重新导出和重新检测 Codex 调用正确服务。

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/main/ipc.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

定义窄 IPC channels：

```ts
export const IPC = {
  getBootstrap: "app:get-bootstrap",
  chooseReportDirectory: "config:choose-report-directory",
  startResearch: "research:start",
  cancelResearch: "research:cancel",
  listHistory: "history:list",
  readReport: "history:read-report",
  openPdf: "history:open-pdf",
  retryPdf: "history:retry-pdf",
  redetectCodex: "codex:redetect",
  researchEvent: "research:event"
} as const;
```

Preload 使用 `contextBridge.exposeInMainWorld("stockResearch", api)`，每个方法显式包装对应 channel。不要暴露完整 `ipcRenderer`。

`src/main/index.ts`：

- `app.whenReady()` 后创建 stores、locator、runner factory、PDF exporter、service。
- 注册 IPC。
- 创建主窗口。
- 启动时检测 Codex 状态并通过 bootstrap 数据返回 Renderer。

**Step 4: 运行测试和构建**

Run:

```bash
npx vitest run tests/main/ipc.test.ts
npm run build
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/shared/ipc.ts src/main src/preload src/renderer/global.d.ts tests/main/ipc.test.ts
git commit -m "feat: expose secure Electron IPC for stock research"
```

## Task 10: 实现 Renderer 单页界面

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/styles.css`
- Create: `tests/renderer/view-model.test.ts`
- Create: `src/renderer/view-model.ts`

**Step 1: 写失败测试**

将 UI 状态逻辑放入纯 `view-model.ts`。覆盖：

- 运行时主按钮文案为“停止调研”。
- 空输入时不能启动。
- 历史记录按时间倒序展示。
- 选择历史记录后展示 Markdown。
- `completed_pdf_failed` 显示“重新导出 PDF”。
- Codex 未安装和未登录状态显示不同提示。

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/renderer/view-model.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

布局：

- 左栏宽约 320px：标题、输入框、主按钮、状态提示、历史列表。
- 右侧顶部：报告目录摘要、“配置报告目录”、“打开 PDF”和按需显示的“重新导出 PDF”。
- 右侧标签：`调研报告`、`实时输出`。
- 报告使用 `renderMarkdown()` 输出。
- 实时输出只追加筛选后的重要中文进展，只有日志区域自动滚动；调研期间在顶部固定展示动态 `working` 状态和耗时。
- 点击“调研”且目录未配置时，先调用目录选择 IPC；取消后保持空闲。
- 运行中点击主按钮调用 cancel。
- 启动失败、PDF 失败、Codex 缺失和未登录使用明确中文提示。

保持纯 DOM + TypeScript，不引入 React。

**Step 4: 运行测试和构建**

Run:

```bash
npx vitest run tests/renderer/view-model.test.ts
npm run build
```

Expected: PASS。

**Step 5: 本地启动烟雾测试**

Run:

```bash
npm run dev
```

Expected: Electron 窗口打开；左右布局、标签页、配置按钮和空历史状态可见。关闭窗口后命令退出。

**Step 6: Commit**

```bash
git add src/renderer tests/renderer
git commit -m "feat: add stock research desktop interface"
```

## Task 11: 增加端到端假 Codex 开发模式

**Files:**
- Modify: `src/main/index.ts`
- Create: `tests/integration/fake-codex-flow.test.ts`
- Create: `docs/windows-acceptance.md`

**Step 1: 写失败测试**

增加内部 launcher override，仅在设置 `STOCK_TOOL_CODEX_EXECUTABLE` 时启用。集成测试使用 fake Codex 覆盖：

- 从 service 启动到历史完成。
- 事件日志和 stderr 日志存在。
- Markdown 报告存在。
- PDF exporter 通过 fake 注入后收到目标路径。

**Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run tests/integration/fake-codex-flow.test.ts
```

Expected: FAIL。

**Step 3: 写最小实现**

支持：

```text
STOCK_TOOL_CODEX_EXECUTABLE=<path>
```

该 override 仅用于开发和测试，不写入配置文件，不在 UI 暴露。

编写 `docs/windows-acceptance.md`，列出：

1. 安装并登录 Codex CLI。
2. 验证 `codex login status`。
3. 测试 `codex.cmd` 不在 `PATH` 时自动修复当前用户 `PATH`。
4. 首次点击调研时选择目录。
5. 使用真实标的完成一次调研。
6. 检查实时输出、最终 Markdown、中文 PDF、文件名和历史重开。
7. 测试取消。
8. 测试 PDF 打开。

**Step 4: 运行完整自动化验证**

Run:

```bash
npm test
npm run build
```

Expected: PASS。

**Step 5: Commit**

```bash
git add src/main/index.ts tests/integration docs/windows-acceptance.md
git commit -m "test: cover fake Codex end-to-end flow"
```

## Task 12: Windows 打包和手工验收

**Files:**
- Modify: `docs/windows-acceptance.md`
- Create: `README.md`

**Step 1: 写 README**

说明：

- 目标用途和非投资建议声明。
- Windows 前提：安装并登录 Codex CLI。应用内嵌 `$research-a-share-stock` skill，不要求用户单独安装。
- 开发命令：`npm install`、`npm run dev`、`npm test`、`npm run build`。
- Windows 打包命令：`npm run dist:win`。
- 首次使用流程。
- 报告和日志保存位置。

**Step 2: 在 Windows 上运行完整验证**

Run:

```powershell
npm install
npm test
npm run build
npm run dist:win
```

Expected:

- 所有测试 PASS。
- `release/` 目录下生成 NSIS `.exe` 安装包。

**Step 3: 执行手工验收**

逐项执行 `docs/windows-acceptance.md`。记录：

- Windows 版本。
- Node.js 版本。
- Codex CLI 版本。
- 安装包文件名。
- 真实调研标的。
- PDF 文件路径。
- 任何未通过项。

**Step 4: 修复验收问题并重新验证**

Run:

```powershell
npm test
npm run build
npm run dist:win
```

Expected: PASS。

**Step 5: Commit**

```bash
git add README.md docs/windows-acceptance.md
git commit -m "docs: add Windows setup and acceptance guide"
```

## 完成验证清单

自动化：

```bash
npm test
npm run build
git diff --check
git status --short
```

Windows：

```powershell
npm run dist:win
codex --version
codex login status
```

必须确认：

- 应用不读取 credential 文件。
- Codex prompt 使用 `$research-a-share-stock`。
- Codex 运行参数包含 `--search`、`read-only` sandbox 和 `never` approval。
- Codex 根级参数 `--search`、`-s read-only` 和 `-a never` 位于 `exec` 前。
- 标的名称仅通过 stdin 传入。
- 首次调研可引导选择报告目录。
- PDF 文件名为 `<标的名称>_YYYY-MM-DD_HHmmss.pdf`。
- 历史记录可重开报告并打开 PDF。
- PDF 导出失败可重试。
- Windows 用户级 `PATH` 自动修复不需要管理员权限。

## 官方 Electron API 参考

- `contextBridge`: https://www.electronjs.org/docs/latest/api/context-bridge
- `dialog.showOpenDialog()`: https://www.electronjs.org/docs/latest/api/dialog
- `webContents.printToPDF()`: https://www.electronjs.org/docs/latest/api/web-contents
- `shell.openPath()`: https://www.electronjs.org/docs/latest/api/shell
