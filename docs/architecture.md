# A 股调研助手代码架构设计

本文档描述当前代码库的生产架构和模块边界，供后续开发、重构和排查问题时参考。它只记录程序代码设计，不记录实施计划、任务步骤、提交步骤或发布流程。

## 文档维护规则

每次修改并提交代码前，都必须检查本文档是否需要同步更新。以下变化通常需要更新本文档：

- 新增、删除或移动生产模块。
- 修改主进程、preload、renderer、shared 的职责边界。
- 修改 IPC API、共享类型、用户数据文件格式或存储位置。
- 修改股票调研、盯盘脑图、provider、缓存、PDF 导出、Codex 调用等核心流程。
- 新增外部依赖、数据源、AI provider 或用户配置字段。
- 改变测试代码和生产代码的边界约定。

不需要把普通 bugfix 的实现细节写入本文档，除非该 bugfix 改变了模块职责、数据结构或核心数据流。

## 总体架构

应用是 Electron + TypeScript 桌面程序，由四层组成：

```text
src/main/      Electron 主进程：窗口、可信文件系统、外部进程、IPC 服务端、持久化、数据 provider
src/preload/   preload bridge：用 contextBridge 暴露受限 API
src/renderer/  浏览器渲染层：DOM、界面控制器、用户交互和展示
src/shared/    主进程、preload、renderer 共用类型、IPC 定义和纯函数
```

核心原则：

- Renderer 不直接访问 Node.js API，不直接读写文件，不直接联网获取行情。
- Preload 只暴露 `StockResearchApi`，不放业务逻辑。
- Main process 负责所有可信操作，包括文件读写、Codex CLI、PDF 导出、行情接口调用和数据校验。
- Shared 只能放跨层共用的类型和纯函数，不能依赖 Electron、DOM 或 Node 运行时副作用。
- 股票调研和盯盘脑图是两个主功能模块，共享应用壳层和少量通用配置，但不共享运行状态。

## 启动与依赖装配

入口文件是 `src/main/index.ts`。

启动流程：

1. `app.whenReady()` 后解析用户数据目录。
2. 创建配置、历史、调研规范、盯盘树、行情缓存等 store。
3. 解析内嵌 skill 目录。
4. 创建 Codex 检测器、PDF 导出器、调研 provider、调研服务、行情 provider、盯盘行情服务。
5. 调用 `registerIpcHandlers()` 注册 IPC。
6. 创建主窗口并加载 renderer 页面。

`src/main/index.ts` 只做依赖装配和 Electron 生命周期处理，不承载具体业务规则。业务规则应该落在 service、provider、store 或 feature controller 中。

### 用户数据目录

用户数据目录由 `src/main/app-data-directory.ts` 解析：

- 开发/源码运行时：使用项目根下的 `user_data`。
- 打包运行时：使用可执行程序所在根目录下的 `user_data`。

这保证部署到软件根目录后，脑图、行情缓存、配置和调研历史都在软件根目录 `user_data/` 下维护。

## IPC 结构

IPC 常量和 renderer 可见 API 定义在 `src/shared/ipc.ts`。

服务端注册入口：

```text
src/main/ipc.ts
```

该文件只聚合三个注册函数：

```text
src/main/app-ipc.ts
src/main/modules/research/research-ipc.ts
src/main/modules/watch/watch-ipc.ts
```

### App IPC

`src/main/app-ipc.ts` 负责应用通用能力：

- `getBootstrap`
- `chooseReportDirectory`
- `redetectCodex`

`getBootstrap` 返回：

- `config`
- `history`
- `codex`
- `watchTree`

这使 renderer 首次启动时能一次拿到应用配置、历史记录、Codex 状态和盯盘脑图。

### Research IPC

`src/main/modules/research/research-ipc.ts` 负责股票调研能力：

- 调研规范读取、保存、恢复。
- 启动、取消调研。
- 历史列表、报告读取、PDF 打开、PDF 重试导出。

该模块只做参数校验和服务调用，不直接拼 prompt、不直接运行 Codex、不直接写报告文件。

### Watch IPC

`src/main/modules/watch/watch-ipc.ts` 负责盯盘脑图能力：

- 读取和保存脑图。
- 获取行情快照。
- 获取缓存感知行情和走势。
- 强制刷新行情。
- 搜索 A 股股票候选。

该模块只做参数校验和服务调用，不直接拼接东方财富 URL，不直接操作 DOM。

## Preload

`src/preload/index.ts` 用 `contextBridge.exposeInMainWorld()` 暴露 `window.stockResearch`。

Preload 的职责：

- 把 renderer 调用转换为 `ipcRenderer.invoke()`。
- 把调研事件订阅转换为 `ipcRenderer.on()`，并返回取消订阅函数。
- 保持暴露 API 与 `src/shared/ipc.ts` 的 `StockResearchApi` 类型一致。

Preload 不负责：

- 参数业务校验。
- 状态缓存。
- UI 逻辑。
- 文件或网络访问。

## Shared 层

### 共享类型

`src/shared/types.ts` 定义跨层传输的数据结构。

主要类型：

- `AppConfig`
- `ResearchRecord`
- `ResearchStatus`
- `CodexEnvironmentStatus`
- `ResearchProgressEvent`
- `AppBootstrap`
- `WatchTreeNode`
- `WatchTreeConfig`
- `WatchIndustryPosition`
- `StockQuote`
- `StockTrend`
- `WatchMarketData`
- `WatchMarketCache`
- `WatchMarketHistoryCache`
- `WatchDataTransferResult`
- `StockSearchResult`

`StockTrend` 是 provider 返回给上层的标准化分时结构，必须包含真实交易日标签：

```ts
interface StockTrend {
  secid: string;
  tradingDate: string;
  fetchedAt: string;
  points: StockTrendPoint[];
  errorMessage?: string;
}
```

`tradingDate` 来自行情数据源返回的实际分时日期，不使用程序打开当天的自然日期代替。

股票叶子节点可选保存 `industryPosition`，取值为：

```ts
type WatchIndustryPosition = "leader1" | "leader2" | "leader3";
```

该字段表示用户手工维护的行业地位，分别对应“龙头一”、“龙头二”、“龙头三”。字段保存在 `watch-tree.json` 的股票节点内；未设置时省略。

股票叶子节点还可选保存持仓状态：

```ts
interface WatchTreeStockNode {
  // 其他字段省略
  isHolding?: boolean;
}
```

`isHolding: true` 表示持仓股；`false` 或字段缺失均表示非持仓股，并在脑图配置规范化时省略。`validateWatchTreeConfig()` 只接受布尔值，其他类型会作为无效配置拒绝。该字段和节点其他属性一起保存在 `watch-tree.json` 中。

`StockQuote` 是 provider 返回给上层的标准化行情快照。除价格和涨跌幅外，当前可选包含：

- `peTtm`: TTM 市盈率。
- `turnoverRate`: 换手率百分比。
- `floatMarketCap`: 流通市值，单位为元。
- `limitRate` 和 `limitStatus`: 涨跌停相关标准化字段。

`AppConfig` 当前字段：

```ts
interface AppConfig {
  reportDirectory?: string;
  watchMarketProviderId?: "east-money" | "mock-cache";
  researchProviderId?: string;
}
```

`watchMarketProviderId` 是盯盘行情 provider 选择配置。顶部 Electron 菜单 `Setting -> 数据源` 不直接承载所有选项，而是通知 renderer 打开独立的数据源设置弹窗。用户在弹窗中选择“东方财富”或“模拟数据”并保存后，renderer 调用 `watch-market-provider:set`；主进程写入 `user_data/config.json`，切换当前 provider，并通过 `watch-market-provider:changed` 通知 renderer 重新加载盯盘行情。`Setting` 下后续新增模型 API 等配置时，应复用这种“菜单入口 -> 独立设置界面 -> IPC 保存”的结构，避免把大量配置项堆在系统菜单里。`researchProviderId` 是股票调研 provider 的预留扩展点。

### 盯盘纯函数

`src/shared/watch-tree.ts` 放置盯盘脑图的纯函数：

- 节点校验。
- `secid` 校验。
- 节点查找、替换、删除、追加。
- 收集股票 `secid`。
- 分类平均涨跌幅计算。
- 分类上涨/下跌股票数统计。
- 分类板块强度指数计算入口。
- 最近 5 个交易日分类强度曲线点生成。
- 展示用子节点涨跌幅排序。
- 报价点合并到走势。
- 走势 SVG sparkline 生成。股票分时走势使用固定 A 股全天时间轴：`09:30` 位于最左，`15:00` 位于最右，盘中或模拟回放只绘制已经到达的左侧片段；分类强度历史等非分时数据仍按点均分横轴。
- 涨跌幅样式 class 计算。

这些函数不依赖 DOM 或 Electron，可在 main、renderer、测试中复用。

`src/shared/data-calc-helper.ts` 放置 provider 无关的通用行情计算：

- `calculateChangePercent`: 用价格和昨收价计算涨跌幅。
- `normalizeIntradayTrendPoints`: 把 provider 解析出的分时价格标准化为 `StockTrendPoint`。
- `calculateSectorStrengthIndex`: 板块强度指数算法。
- `calculateSuddenStockMove`: 股票分时异动判定算法。

板块强度指数算法用于分类节点，输入是该分类下所有股票的标准化 quote。算法分两层：

```text
基础强弱分 = 0.60 * 涨跌幅强度分 + 0.40 * 涨跌家数宽度分
板块强度指数 = clamp(基础强弱分 + 涨跌停事件冲击分, -100, +100)
```

其中：

```text
涨跌幅强度分 = 100 * average(clamp(changePercent / limitRate, -1, 1))
涨跌家数宽度分 = 100 * (上涨家数 - 下跌家数) / 有行情股票数
涨跌停事件冲击分 = clamp(12 * sign(净涨跌停数) + 80 * 净涨跌停数 / 有行情股票数, -35, +35)
净涨跌停数 = 涨停家数 - 跌停家数
```

涨跌停事件不参与固定权重平均，而是作为额外冲击项。这样没有涨停或跌停时，指数仍使用完整基础强弱区间；出现涨停或跌停时，指数会产生明显增强或削弱。`limitRate` 可由 provider 标准化提供；缺失时 helper 按 `secid` 推断常见 A 股涨跌幅限制：主板 10%，创业板/科创板 20%，北交所代码段 30%。未来 provider 如果能返回更精确的涨跌停状态，应写入 `StockQuote.limitRate` 和 `StockQuote.limitStatus`，上层算法无需改动。

股票分时异动算法用于 UI 提醒。默认取最新分时点向前 5 分钟作为观察窗口，计算窗口首尾涨跌幅变化；绝对变化达到 1.2 个百分点时判定为异动，正值为上涨异动，负值为下跌异动。该算法只依赖标准化 `StockTrendPoint.changePercent`，不关心数据源来自东财、Tushare、AkShare 或券商接口。

### Markdown 渲染

`src/shared/render-markdown.ts` 把 Markdown 转为安全展示用 HTML。Renderer 展示报告和 PDF 导出链路都会依赖 Markdown 渲染行为。

## 主进程通用基础设施

### JSON Store

`src/main/json-store.ts` 是通用 JSON 文件读写封装。领域 store 通过它实现持久化：

- `src/main/config-store.ts`
- `src/main/history-store.ts`
- `src/main/watch-tree-store.ts`
- `src/main/watch-market-cache-store.ts`

JSON store 的职责是：

- 文件不存在时返回默认值。
- 读取并解析 JSON。
- 写入 JSON。
- 在 JSON 损坏时抛出包含文件路径的错误。

领域 store 负责各自的数据校验和领域方法。

### 外部链接

`src/main/external-links.ts` 拦截窗口导航，将 `http` 和 `https` 链接交给系统默认浏览器打开，避免主窗口跳出应用页面。

### PDF 导出

`src/main/pdf-exporter.ts` 用隐藏 `BrowserWindow` 渲染 Markdown HTML，再通过 `webContents.printToPDF()` 导出 PDF。调研服务只依赖 `PdfExporterLike` 接口，不直接操作 BrowserWindow。

## 股票调研模块

股票调研模块分为 renderer 控制器、IPC、service、provider、Codex runner 和持久化 store。

### Renderer 调研控制器

文件：

```text
src/renderer/features/research/research-controller.ts
```

职责：

- 绑定调研按钮、目录选择、历史刷新、PDF 打开、PDF 重试、调研规范保存/恢复事件。
- 管理调研运行态 `running`。
- 管理当前选中的历史记录。
- 渲染历史列表。
- 渲染报告 Markdown。
- 处理实时输出和状态事件。
- 管理 working indicator 和耗时显示。

该控制器不直接访问文件系统、不直接运行 Codex、不直接导出 PDF。

### 调研 IPC

文件：

```text
src/main/modules/research/research-ipc.ts
```

职责：

- 校验 renderer 传入的 `stockName`、`id`、`spec`。
- 调用 `ResearchService`、`ResearchSpecStore`、`HistoryStore`、`shell.openPath()`。

### ResearchService

文件：

```text
src/main/research-service.ts
```

职责：

- 校验股票名称。
- 检查报告目录。
- 检查当前是否已有调研任务。
- 创建 run 目录和 `ResearchRecord`。
- 调用 `ResearchProvider` 执行调研。
- 写入最终 Markdown。
- 调用 PDF exporter。
- 更新历史状态。
- 处理取消、失败、PDF 导出失败、PDF 重试导出和报告读取。
- 通过 `onProgress` 向主窗口转发进度事件。

`ResearchService` 不知道 Codex CLI 的启动参数、prompt 内容、skill 复制细节。它只依赖 `ResearchProvider`。

### ResearchProvider

接口文件：

```text
src/main/modules/research/providers/research-provider.ts
```

接口：

```ts
interface ResearchProvider {
  readonly id: string;
  readonly label: string;
  detect(): Promise<CodexEnvironmentStatus>;
  run(request: ResearchProviderRequest): Promise<ResearchProviderResult>;
  cancel(): void;
}
```

当前实现：

```text
src/main/modules/research/providers/codex-cli-provider.ts
```

`CodexCliResearchProvider` 的职责：

- 调用 `CodexLocator` 检测 Codex CLI。
- 规范化 Codex 不可用或未登录的提示。
- 调用 `ResearchSkillPreparer` 准备当前 run 目录下的 skill 副本。
- 调用 `buildResearchPrompt()` 生成 prompt。
- 创建并运行 `CodexRunner`。
- 转发 Codex 输出文本。
- 取消当前 runner。

未来接入自定义 AI 模型时，应新增 provider 实现，而不是修改 `ResearchService` 主流程。

### Codex 相关组件

```text
src/main/codex-locator.ts
src/main/codex-launcher-override.ts
src/main/codex-runner.ts
src/main/codex-events.ts
src/main/codex-prompt.ts
src/main/windows-command.ts
src/main/windows-user-path.ts
src/main/research-skill-preparer.ts
src/main/research-spec-store.ts
```

职责划分：

- `CodexLocator`：检测 Codex CLI、Windows 用户 PATH 修复。
- `getCodexLauncherOverride`：开发环境指定 Codex 可执行文件。
- `CodexRunner`：启动 Codex 子进程、写入 prompt、解析 stdout/stderr、处理取消。
- `CodexJsonlParser`：解析 Codex JSONL 输出，筛选展示事件。
- `buildResearchPrompt`：生成调研 prompt。
- `ResearchSkillPreparer`：每次任务前复制内嵌 skill，并写入用户维护的调研规范副本。
- `ResearchSpecStore`：维护用户可编辑的 `stock_research_spec.md`。

### 调研数据流

```text
Renderer research-controller
  -> preload StockResearchApi.startResearch()
  -> IPC research:start
  -> ResearchService.start()
  -> ResearchProvider.detect()
  -> ResearchProvider.run()
  -> CodexCliResearchProvider
  -> CodexRunner
  -> report.md
  -> ResearchService writes history and exports PDF
  -> Renderer receives ResearchRecord and refreshes history
```

实时输出流：

```text
CodexRunner stdout
  -> CodexJsonlParser
  -> CodexCliResearchProvider request.onOutput()
  -> ResearchService onProgress
  -> BrowserWindow.webContents.send(IPC.researchEvent)
  -> preload onResearchEvent()
  -> research-controller.handleProgress()
```

## 盯盘脑图模块

盯盘脑图模块分为 renderer 控制器和展示子模块、IPC、脑图 store、行情 service、行情 cache store、行情 provider。

### Renderer 盯盘入口

`src/renderer/main.ts` 创建 `createWatchController()`，并把它接入 `createShellController()` 的 watch 生命周期：

- 进入盯盘：`watchController.activate()`
- 离开盯盘：`watchController.deactivate()`

`main.ts` 不直接包含盯盘业务逻辑。

### WatchController

文件：

```text
src/renderer/features/watch/watch-controller.ts
```

职责：

- 维护当前脑图配置 `WatchTreeConfig`。
- 维护当前行情 `quotes` 和 `trends`。
- 维护折叠节点集合。
- 维护股票搜索选择状态。
- 维护节点编辑弹窗状态。
- 在股票节点编辑弹窗中管理“持仓股”选项：新增股票默认“否”，编辑时回填已有状态，保存“否”时省略 `isHolding`，保存“是”时写入 `isHolding: true`。该控件只对股票节点显示。
- 维护面板拖拽平移状态。
- 绑定盯盘相关 DOM 事件。
- 从 bootstrap 中 hydrate 初始脑图。
- 激活盯盘时加载行情并启动 10 秒轮询。
- 同一时刻只允许一轮行情加载或刷新在途；定时器、手动刷新或数据源切换遇到未完成请求时直接跳过，避免轮询叠加。
- 离开盯盘时停止轮询。
- 保存脑图后重新加载行情。
- 触发盯盘数据导出。
- 导入盯盘数据前请求用户确认，导入成功后重新 hydrate 脑图并加载行情。

该控制器负责业务状态和事件协调，不负责生成节点 HTML，不负责连接线坐标计算，不直接访问主进程文件系统。

### WatchView

文件：

```text
src/renderer/features/watch/watch-view.ts
```

职责：

- 渲染空状态提示。
- 渲染分类节点和股票节点 HTML。
- 渲染分类节点平均涨跌幅、上涨/下跌股票数。
- 渲染分类子节点时按涨跌幅降序排序；股票节点使用自身涨跌幅，分类节点使用递归平均涨跌幅，无行情节点排在有行情节点后面。排序只影响展示，不写回 `watch-tree.json`。
- 渲染股票走势 sparkline 和涨跌幅数字。
- 根据 `calculateSuddenStockMove()` 的结果，在可见股票名称上叠加渐变闪烁的异动箭头；上涨为红色，下跌为绿色。异动状态每次渲染时从最新走势即时计算，不写入用户配置或行情缓存。
- 当折叠分类节点下存在异动股票且股票被折叠隐藏时，在分类节点上叠加渐变感叹号；用户展开分类后，因股票已经可见，该分类节点不再显示隐藏异动提示。
- 股票节点设置 `industryPosition` 时，在涨跌幅右侧显示立体星标：`leader1` 金色、`leader2` 银色、`leader3` 铜色。
- 股票节点设置 `isHolding: true` 时，名称容器增加 `is-holding` 语义 class，名称使用高亮紫色、粗体和 `drop-shadow` 光晕。持仓样式只作用于股票名称，不改变涨跌幅和走势红绿、行业地位星标或异动箭头；同时输出视觉隐藏的“持仓股”文本供辅助技术读取。
- 股票 tooltip 显示价格、涨跌幅、TTM 市盈率、换手率、流通市值和持仓状态。
- 渲染 tooltip 文案。
- 格式化涨跌幅。

`watch-view.ts` 只根据输入的 view state 生成 DOM 内容，不负责事件绑定、行情加载、保存脑图或轮询。

### WatchConnectors

文件：

```text
src/renderer/features/watch/watch-connectors.ts
```

职责：

- 在节点 DOM 渲染完成后读取布局坐标。
- 计算父子节点之间的贝塞尔曲线路径。
- 更新 `.watch-connectors` SVG。
- 通过 `requestAnimationFrame` 调度重绘。

连接线绘制和节点 HTML 渲染分开，是因为前者依赖 DOM 布局测量，后者是数据到 HTML 的展示映射。修改节点内容不应影响连接线算法，修改连接线曲率或颜色也不应影响节点渲染。

### WatchContextMenu

文件：

```text
src/renderer/features/watch/watch-context-menu.ts
```

职责：

- 构造分类节点右键菜单。
- 构造股票节点右键菜单。
- 构造空白区域创建分类菜单。
- 控制菜单显示位置和隐藏。

菜单点击后的动作由 `WatchController` 处理。

### Watch IPC

文件：

```text
src/main/modules/watch/watch-ipc.ts
```

职责：

- 校验 `secids`、`query`、`config` 参数。
- 调用 `WatchTreeStore`、`MarketDataProvider`、`WatchMarketService`。
- 弹出目录选择框并调用盯盘数据导入导出服务。

### WatchTreeStore

文件：

```text
src/main/watch-tree-store.ts
```

职责：

- 读写 `watch-tree.json`。
- 保存前校验脑图结构。
- 维护用户自定义分类树和股票叶子节点。

### WatchMarketService

文件：

```text
src/main/watch-market-service.ts
```

职责：

- 根据中国时区日期判断同日缓存。
- 同日缓存完整时直接返回缓存。
- 缓存缺失、缺字段或走势点异常时调用 `MarketDataProvider` 重新获取。
- 将走势点价格归一化为相对昨收的涨跌幅。
- 当 quote 接口不可用但 trend 有最新点时，用 trend 最新点兜底生成可展示 quote，避免有走势数据时仍显示“暂无行情”。
- 刷新时把最新 quote 合并进同日 trend。
- 写入 `watch-quotes-cache.json` 中最近 5 个交易日的历史缓存。

该服务依赖 `MarketDataProvider`，不依赖东方财富具体类。

### WatchDataTransferService

文件：

```text
src/main/watch-data-transfer-service.ts
```

职责：

- 导出当前 `watch-tree.json` 和最近 5 个交易日行情历史。
- 导入用户指定目录中的盯盘数据包。
- 导入时校验脑图结构和行情历史结构。
- 导入成功后覆盖本机盯盘脑图和行情历史缓存。

持仓状态属于 `watch-tree.json` 股票节点字段，因此会随现有脑图数据包直接导出；导入时经过 `validateWatchTreeConfig()` 校验并规范化，不需要单独的数据迁移或附加文件。

导出目录包含：

```text
metadata.json
watch-tree.json
watch-market-history.json
```

`metadata.json` 只用于标识数据包格式和导出时间。实际导入依赖 `watch-tree.json` 和 `watch-market-history.json`。

### MarketDataProvider

接口文件：

```text
src/main/modules/watch/market-data/market-data-provider.ts
```

接口：

```ts
interface MarketDataProvider {
  readonly id: "east-money" | "mock-cache";
  readonly label: string;
  readonly cacheBehavior?: "standard" | "ephemeral";
  listQuotes(secids: string[]): Promise<StockQuote[]>;
  listTrends(secids: string[]): Promise<StockTrend[]>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
}
```

当前实现：

```text
src/main/modules/watch/market-data/selectable-market-data-provider.ts
src/main/modules/watch/market-data/east-money-provider.ts
src/main/modules/watch/market-data/mock-cache-provider.ts
src/shared/data-calc-helper.ts
src/main/east-money-quote-service.ts
```

`SelectableMarketDataProvider` 是运行时代理 provider。`WatchMarketService`、IPC 和 renderer 始终依赖同一个 `MarketDataProvider` 接口；数据源设置弹窗保存后只改变代理内部当前 provider。选择 mock provider 时会调用其 `reset()`，让模拟回放从最近真实交易日第一个分时点重新开始。

`EastMoneyMarketDataProvider` 是 provider 适配器。`EastMoneyQuoteService` 负责东方财富公开接口：

- 股票搜索。
- 行情快照。快照请求包含最新价、昨收价、涨跌幅、TTM 市盈率、换手率和流通市值；当接口返回的涨跌幅为 0 但最新价和昨收价不一致时，适配器用最新价和昨收价重算涨跌幅。
- 当日分时走势。分时请求必须包含完整 `fields1=f1...f13`，确保返回中带有 `prePrice` 昨收价；适配器用每个分时价格相对昨收价计算 `StockTrendPoint.changePercent`。
- 东方财富返回格式解析。
- 失败时返回可展示的 error message。

生产环境在 `src/main/index.ts` 中向 `EastMoneyMarketDataProvider` 注入 Electron `net.fetch`，使行情请求使用 Chromium 网络栈和 Windows 系统代理配置。URL 和 `AbortSignal` 等请求选项必须完整透传。`EastMoneyQuoteService` 仍只依赖通用 fetch 接口，测试可以注入 fake fetch；不得在 provider 内直接依赖 Electron，以保持数据适配逻辑可独立测试。

东财请求默认 5 秒超时，超时后转换为可展示的“行情请求超时”，由下一轮轮询继续重试，不允许单个连接永久阻塞整个行情批次。`listQuotes()` 和 `listTrends()` 各自最多并发 2 个请求，避免一次为多只股票创建过多系统代理连接；返回结果顺序仍与输入去重后的 `secid` 顺序一致。

`MockCacheMarketDataProvider` 是独立的模拟数据 provider，`id` 为 `mock-cache`，`cacheBehavior` 为 `ephemeral`。它不访问外部接口，而是从 `WatchMarketCacheStore.getHistory()` 读取 `watch-quotes-cache.json` 中最近一个包含目标股票分时走势的真实交易日。回放开始时只返回第一个分时点；之后按当前刷新节奏推进，每 10 秒多返回一个分时点。`listQuotes()` 使用当前模拟时间点的最后一个分时点生成标准 quote，`listTrends()` 只返回从开盘到当前模拟点的走势。对 renderer 来说，这和真实盘中行情逐步到达的结构一致。

`data-calc-helper.ts` 的主实现位于 `src/shared/`，main 侧 `src/main/modules/watch/market-data/data-calc-helper.ts` 只保留兼容导出入口。provider 负责解析各自源数据字段并调用 helper；`WatchMarketService` 不用 quote 反推昨收价，也不补算分时涨跌幅。

未来新增 Tushare、AkShare + 东方财富或券商接口时，应新增 `MarketDataProvider` 实现，不改 renderer 盯盘模块，不改 `WatchMarketService` 的缓存合并主流程。

### 盯盘数据流

启动加载：

```text
main getBootstrap
  -> WatchTreeStore.get()
  -> renderer main
  -> watchController.hydrate(state.watchTree)
  -> watch-view render tree
```

进入盯盘：

```text
shell-controller activates watch
  -> watchController.activate()
  -> getWatchMarketData(secids)
  -> WatchMarketService.get()
  -> complete cache or MarketDataProvider
  -> WatchMarketData quotes/trends/history
  -> watchController updates quotes/trends/marketHistory
  -> watch-view render stocks and category strength
  -> watch-connectors schedule
```

缓存命中前，`WatchMarketService` 会校验股票和分时走势是否覆盖当前脑图股票。交易时段至少要求北京时间周一到周五，并且处于 `09:30-11:30` 或 `13:00-15:00`。交易日 `09:30` 之后，包括午休和收盘后，只接受当前自然日对应的交易日缓存，不回退到更早交易日。交易时段内，缓存必须从 `09:30` 起按交易分钟连续覆盖到当前交易分钟；午休时段必须连续覆盖到 `11:30`；非交易时段必须连续覆盖到 `15:00`。午休区间 `11:31-13:00` 不属于东财分时返回的连续交易分钟，不要求存在；下午连续分钟从 `13:01` 开始。周末或交易日开盘前不使用当前自然日建缓存，使用 provider 返回的最近有效 `tradingDate`。

如果缓存中的分时价格有波动、但所有分时涨跌幅都是 `0`，说明 provider 标准化失败，这类缓存会被判为不可用并重新拉取。如果缓存写入时间处于同一交易日交易时段、但走势曲线已经包含写入时间之后的分时点，说明历史完整曲线被当作实时曲线处理过，也会判为不可用并重新拉取。

当 provider 返回的 quote 全部不可用且 trend 全部为空或失败时，`WatchMarketService` 会把失败结果返回给本次调用用于提示，但不会写入 `watch-quotes-cache.json`，避免接口或网络临时故障覆盖已有缓存。

`WatchMarketData.history` 返回最近 5 个交易日的 `WatchMarketCache[]`。Renderer 不持久化派生指标，而是在渲染分类节点时用 `categoryStrengthHistory()` 从历史 quote 即时计算每日板块强度指数，并用 sparkline 展示最近几天强度走势。当前曲线基于 `watch-quotes-cache.json` 中已保存的最近 5 个交易日行情。

保存脑图：

```text
watchController saveNode/deleteNode
  -> saveWatchTree(config)
  -> WatchTreeStore.set()
  -> watchController render
  -> watchController loadMarketData()
```

刷新行情：

```text
watchController interval every 10s
  -> refreshWatchMarketData(secids)
  -> WatchMarketService.refresh()
  -> MarketDataProvider.listQuotes()
  -> MarketDataProvider.listTrends() during trading hours
  -> cache write
  -> renderer render
```

当当前 provider 的 `cacheBehavior` 是 `ephemeral` 时，`WatchMarketService` 会跳过缓存命中检查和缓存写入。这个规则用于模拟数据，避免完整历史缓存直接短路模拟回放，也避免把半日回放进度写回真实行情缓存。

刷新时，`mergeQuoteIntoTrend` 只会把快照点合并到尚未包含后续分时点的曲线中。如果已有曲线包含当前快照时间之后的点，说明这是已完整返回的历史分时曲线，快照价不能插入中间，否则会产生错误的垂直毛刺。

## Renderer App Shell

### DOM Registry

文件：

```text
src/renderer/app/dom.ts
```

职责：

- 集中获取所有静态 DOM 元素。
- 元素缺失时立即抛错。
- 导出 `RendererElements` 类型供 feature controller 使用。

新增静态 DOM 元素时，应该先加入 `index.html`，再加入 `dom.ts`。

### Shell Controller

文件：

```text
src/renderer/app/shell-controller.ts
```

职责：

- 管理主功能模块切换。
- 管理调研报告、实时输出、调研规范 tab 切换。
- 在进入/离开 watch 时调用外部注入的生命周期回调。

Shell 不知道调研和盯盘内部状态，只负责导航和可见性。

## Renderer 入口

文件：

```text
src/renderer/main.ts
```

职责：

- 导入样式。
- 创建 `watchController`、`shellController`、`researchController`。
- 绑定 controller 事件。
- 读取 bootstrap。
- 把 bootstrap 分发给对应 controller。
- 订阅调研事件。
- 处理初始化失败的统一错误展示。

`main.ts` 不应放入具体业务逻辑。新增功能模块时，优先新增 feature controller，再在 `main.ts` 装配。

## 用户数据文件

用户数据目录为软件根目录下的 `user_data/`。

当前主要文件：

```text
user_data/config.json
user_data/history.json
user_data/stock_research_spec.md
user_data/watch-tree.json
user_data/watch-quotes-cache.json
user_data/runs/<run-id>/report.md
user_data/runs/<run-id>/events.jsonl
user_data/runs/<run-id>/stderr.log
user_data/runs/<run-id>/.agents/skills/research-a-share-stock/
```

用户选择的报告目录保存导出的 PDF：

```text
<股票名称>_YYYY-MM-DD_HHmmss.pdf
```

### config.json

由 `ConfigStore` 维护。当前字段：

- `reportDirectory`
- `watchMarketProviderId`
- `researchProviderId`

`watchMarketProviderId` 已用于持久化用户在数据源设置弹窗中的选择，并由 main 装配的 `SelectableMarketDataProvider` 执行运行时切换。`researchProviderId` 仍是自定义调研 provider 的扩展预留。

### history.json

由 `HistoryStore` 维护。保存调研历史记录列表，每条记录对应一次 run。

### stock_research_spec.md

由 `ResearchSpecStore` 维护。用户可编辑的调研规范副本，调研任务启动前会被复制进当前 run 的 skill 目录。

### watch-tree.json

由 `WatchTreeStore` 维护。保存用户自定义脑图结构，以及股票节点的 `industryPosition`、`isHolding` 等用户属性。所有读写和导入都经过 `validateWatchTreeConfig()`；其中仅 `isHolding: true` 会持久化，`false` 和缺失字段统一表示非持仓。

### watch-quotes-cache.json

由 `WatchMarketCacheStore` 维护。文件名保留为 `watch-quotes-cache.json`，内容是最近 5 个交易日的行情历史缓存：

```ts
interface WatchMarketHistoryCache {
  version: 2;
  days: WatchMarketCache[];
}
```

`days` 按真实 `tradingDate` 倒序保存，最多 5 个不同交易日。每个 `WatchMarketCache` 保存一个交易日的：

- `tradingDate`
- `updatedAt`
- `quotes`：包含 `changePercent`，可选包含 `peTtm`、`turnoverRate`、`floatMarketCap`、`limitRate` 和 `limitStatus`。
- `trends`

每条 `StockTrend.tradingDate` 必须与所在 `WatchMarketCache.tradingDate` 一致。旧测试数据不作为长期兼容目标。读取到非 `version: 2` 或 trend 缺少交易日标签的缓存时，会按空历史处理；下一次成功刷新会写入新格式。

### 盯盘导出数据包

用户通过“导出数据”选择目录后，应用写入：

```text
metadata.json
watch-tree.json
watch-market-history.json
```

用户通过“导入数据”选择目录后，应用读取同名文件并覆盖本机：

- `user_data/watch-tree.json`
- `user_data/watch-quotes-cache.json`

导入会影响当前脑图和本地行情缓存，renderer 会在导入成功后重新 hydrate 脑图并加载行情。

## 错误处理原则

- Main process 对 IPC 入参做类型和结构校验。
- Renderer 捕获用户操作错误并展示到对应状态区域。
- 行情失败不伪造数据；股票节点显示暂无行情或保留已有缓存。
- Codex 不可用或未登录时，显示明确提示。
- PDF 导出失败时，调研记录进入 `completed_pdf_failed`，保留 Markdown 并允许重试。
- JSON 文件损坏时，store 抛出包含路径的错误，便于定位用户数据问题。

## 扩展点

### 新增行情数据源

新增行情源时：

1. 在 `src/main/modules/watch/market-data/` 下新增 provider。
2. 实现 `MarketDataProvider`。
3. 在 main 装配阶段根据配置选择 provider。
4. 保持 `WatchMarketService` 和 renderer watch 模块不变，除非新增的数据能力改变共享类型。

### 新增调研 AI provider

新增调研 provider 时：

1. 在 `src/main/modules/research/providers/` 下新增 provider。
2. 实现 `ResearchProvider`。
3. provider 内部处理 token、base URL、模型参数、请求协议和取消逻辑。
4. `ResearchService` 仍只处理 run、历史、报告和 PDF。

### 新增主功能模块

新增与“股票调研”“盯盘脑图”平级的模块时：

1. Renderer 新增 `src/renderer/features/<feature>/`。
2. Main 如需可信能力，新增 `src/main/modules/<feature>/`。
3. Shared 如需跨层 API，扩展 `src/shared/ipc.ts` 和必要类型。
4. 在 `src/renderer/main.ts` 和 `src/main/index.ts` 做装配。
5. 不把新模块状态塞进现有 research/watch controller。

## 测试架构

测试代码和生产代码完全分开：

```text
tests/main/         主进程服务、store、IPC、provider、Windows 工具测试
tests/renderer/     renderer view model、模块边界、盯盘前端源码行为测试
tests/shared/       shared 纯函数测试
tests/preload/      preload sandbox/API 暴露测试
tests/integration/  fake Codex 集成流测试
tests/config/       构建和部署脚本配置测试
tests/fixtures/     测试 fixture
```

生产代码不依赖 `tests/`。测试可以读取生产源码做模块边界断言，但生产构建不读取测试代码。

### 重点测试约定

- Service 层测试用 fake dependency 验证模块只依赖接口。
- Provider 测试验证外部接口响应解析和失败降级。
- Store 测试验证文件不存在、损坏、读写和校验行为。
- Renderer 模块边界测试保护 `src/renderer/main.ts` 不重新膨胀。
- Watch 行为测试保护空白区右键、启动 hydrate、走势样式、股票异动箭头、折叠分类异动提示、持仓属性编辑持久化和持仓名称渲染等用户已确认行为。

## 当前非目标

当前代码尚未实现：

- 用户在 UI 中配置自定义 AI provider。
- main process 主动向 renderer 推送盯盘行情刷新事件。
- 多棵盯盘脑图。
- 脑图拖拽排序。
- 交易所认证行情或交易功能。

这些能力应基于现有 provider、controller、store 和 IPC 边界增量实现，不应回退到单文件混合状态。
