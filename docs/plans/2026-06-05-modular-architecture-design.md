# 模块化架构设计

## 目标

将桌面应用拆成可独立演进的主功能模块，降低股票调研、盯盘脑图、应用壳层之间的耦合。重构必须保持现有行为不变，并为未来增加行情数据源和 AI 调研模型提供清晰扩展点。

## 当前问题

- `src/main/index.ts` 同时装配配置、历史、调研、盯盘、行情、窗口和 IPC。
- `src/main/ipc.ts` 把应用通用、股票调研、盯盘脑图的 IPC handler 放在一个函数里。
- `src/renderer/main.ts` 同时管理两个主功能模块的 DOM、状态、事件绑定和业务流程。
- 盯盘行情服务已经有 `quoteService` 注入，但接口命名偏东方财富语义，数据源选择和 provider 身份还没有抽象出来。
- 股票调研服务直接依赖 Codex CLI 的 runner、prompt、skill preparer；未来接入自定义模型时会牵动调研主流程。

## 设计原则

- 主功能模块独立：调研和盯盘并行运行，互不共享运行状态。
- Provider 插件化：行情数据源和 AI 调研模型通过接口接入，默认 provider 保持现有行为。
- 渲染层薄化：Renderer 负责用户交互和展示，后台刷新、缓存和 provider 调用留在 main。
- 分阶段迁移：先拆边界，再抽接口，最后迁移调度逻辑。每阶段都有测试和提交。
- 保持兼容：`user_data/` 文件位置和现有 `watch-tree.json`、`watch-quotes-cache.json` 格式尽量不变；需要新增字段时提供默认值。

## 主模块边界

### App Shell

负责窗口、导航、启动引导数据和通用配置。

Main:

```text
src/main/app/
  app-context.ts
  bootstrap-service.ts
  register-ipc.ts
```

Renderer:

```text
src/renderer/app/
  shell-controller.ts
  dom.ts
```

### Research 模块

负责调研任务、历史记录、报告读取、PDF 导出和 AI provider 调用。

Main:

```text
src/main/modules/research/
  research-ipc.ts
  research-service.ts
  providers/
    research-provider.ts
    codex-cli-provider.ts
```

Renderer:

```text
src/renderer/features/research/
  research-controller.ts
  research-view.ts
```

默认 provider 是 Codex CLI。未来的自定义模型 provider 只实现 `ResearchProvider`：

```ts
interface ResearchProvider {
  readonly id: string;
  readonly label: string;
  run(request: ResearchRequest): Promise<ResearchProviderResult>;
  cancel(): void;
}
```

### Watch 模块

负责脑图配置、行情缓存、行情刷新、股票搜索、趋势图展示。

Main:

```text
src/main/modules/watch/
  watch-ipc.ts
  watch-tree-service.ts
  watch-market-service.ts
  watch-refresh-controller.ts
  market-data/
    market-data-provider.ts
    east-money-provider.ts
```

Renderer:

```text
src/renderer/features/watch/
  watch-controller.ts
  watch-view.ts
  watch-context-menu.ts
  watch-connectors.ts
```

行情 provider 接口：

```ts
interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  listQuotes(secids: string[]): Promise<StockQuote[]>;
  listTrends(secids: string[]): Promise<StockTrend[]>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
}
```

默认 provider 是东方财富。未来增加 Tushare、AkShare + 东方财富、券商接口时，只新增 provider 并通过配置选择，不改 watch renderer 或缓存合并逻辑。

## IPC 设计

拆分为三组注册函数：

```ts
registerAppIpc(...)
registerResearchIpc(...)
registerWatchIpc(...)
```

`src/main/index.ts` 只负责创建依赖并调用这些注册函数。每个 IPC 文件只依赖本模块服务和必要的通用服务。

## Renderer 设计

`src/renderer/main.ts` 缩小为入口：

```ts
const dom = getAppDom();
const research = createResearchController({ api, dom });
const watch = createWatchController({ api, dom });
createShellController({ dom, features: { research, watch } }).initialize();
```

每个 feature controller 只管理自己的状态和 DOM 片段。调研的 `running`、历史选择、输出滚动不再和盯盘的行情缓存、脑图状态放在同一个文件。

## 刷新逻辑

短期保持 renderer 每 15 秒调用 `refreshWatchMarketData`，先完成模块拆分。

第二阶段将定时刷新迁移到 main：

- Renderer 进入盯盘模块时发送 `watch:subscribe-market`。
- Main `WatchRefreshController` 管理定时器和订阅者。
- Main 刷新后通过 `watch:market-event` 推送数据。
- Renderer 只渲染最新数据。

这样调研长任务和行情刷新都在 main 中独立运行，不依赖当前页面的定时器状态。

## 配置扩展

`AppConfig` 后续扩展：

```ts
interface AppConfig {
  reportDirectory?: string;
  watchMarketProviderId?: string;
  researchProviderId?: string;
  researchProviders?: CustomResearchProviderConfig[];
}
```

当前阶段只抽接口，不增加用户选择 UI。默认值：

- `watchMarketProviderId`: `east-money`
- `researchProviderId`: `codex-cli`

## 测试策略

- IPC 拆分：保持现有 `tests/main/ipc.test.ts` 行为，并新增按模块测试。
- Provider 抽象：用 fake provider 验证服务只依赖接口，不依赖东方财富或 Codex CLI 具体类。
- Renderer 拆分：用源码结构测试和现有行为测试覆盖关键绑定。
- 回归：每阶段运行 `npm test`、`npm run build`、`git diff --check`。

## 非目标

- 本轮不实现 Tushare、AkShare、券商接口。
- 本轮不实现自定义 AI 模型 UI。
- 本轮不改变用户数据目录。
- 本轮不改 `watch-tree.json` 的外部兼容格式。
