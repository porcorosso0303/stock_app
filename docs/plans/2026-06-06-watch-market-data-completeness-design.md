# Watch Market Data Completeness Design

## Goal

盯盘脑图只能使用完整、可靠、带真实交易日标签的分时数据绘制走势曲线。任何时间打开程序，都先选择最近有效交易日数据；缓存缺失或不完整时，先通过行情 provider 拉取并补齐，再交给 renderer 绘图。

## Decisions

- 不维护本地 A 股节假日表。
- 最近交易日以行情 provider 实际返回的分时数据日期为准。
- `WatchMarketService` 不解析 provider 原始字段，不猜昨收价，不用快照价反推昨收价。
- provider 负责把原始接口数据解析成统一结构。
- 与 provider 无关的通用行情计算放到 `src/main/modules/watch/market-data/data-calc-helper.ts`。
- 本次只新增 `data-calc-helper.ts` 一个源文件，不再拆 `market-session.ts`、`watch-market-completeness.ts` 等小模块。

## Provider Contract

`MarketDataProvider.listTrends(secids)` 返回给上层的 `StockTrend` 必须已经标准化：

```ts
interface StockTrend {
  secid: string;
  tradingDate: string;
  fetchedAt: string;
  points: StockTrendPoint[];
  errorMessage?: string;
}

interface StockTrendPoint {
  time: string;          // HH:mm
  price?: number;
  changePercent: number; // 相对昨收价
}
```

provider 的职责：

- 解析源数据中的真实交易日。
- 解析源数据中的昨收价 `previousClose`。
- 解析每分钟价格点。
- 调用 `data-calc-helper` 计算通用指标，例如分时涨跌幅。
- 过滤无效原始点，并按时间升序返回。
- 如果无法获得完整计算所需数据，返回带 `errorMessage` 的不可用结果。

provider 之外的上层逻辑不能知道东财 `prePrice`、`f43`、`f60`、`trends` 字符串格式或未来 Tushare 字段名。

## Data Calc Helper

文件：

```text
src/main/modules/watch/market-data/data-calc-helper.ts
```

职责：

- 放置 provider 无关的行情计算公式。
- 第一批函数包括：
  - 根据 `price` 和 `previousClose` 计算涨跌幅。
  - 根据 `previousClose` 批量补齐分时点 `changePercent`。
  - 交易时间分钟工具函数可先保留在 `WatchMarketService` 内部，除非多个 provider 需要复用。

不放入：

- 东财字段解析。
- Tushare 字段解析。
- 缓存命中策略。
- renderer 绘制逻辑。

## Cache Semantics

`WatchMarketCache.tradingDate` 必须来自 provider 返回的真实交易日，而不是当前自然日。

缓存最多保存最近 5 个真实交易日。每个 `WatchMarketCache` 保存一个交易日的所有股票：

- `tradingDate`
- `updatedAt`
- `quotes`
- `trends`

每条 `StockTrend.tradingDate` 必须等于所在 cache 的 `tradingDate`。

旧测试数据不作为兼容目标；读取到缺少 `tradingDate` 的 trend 可以判为不可用并重新拉取。

## Completeness Rules

绘图前，`WatchMarketService` 判断缓存是否可用。

交易时段打开程序：

- 当前时间在 A 股交易时间内：`09:30-11:30` 或 `13:00-15:00`。
- 使用 provider 返回的真实 `tradingDate`。
- 每只股票的分时数据必须覆盖 `09:30` 到当前交易分钟。
- 午休时段可以只要求覆盖到 `11:30`。
- 后续每 10 秒重新拉取分时数据并写入缓存，直到收盘。

非交易时间打开程序：

- 使用 provider 可返回的最近有效交易日。
- 每只股票分时数据必须覆盖到收盘点，优先要求 `15:00`。
- 如果缓存没有最近有效交易日，或该交易日数据不完整，先拉取完整分时，再绘图。

周末和节假日：

- 不按当前自然日建缓存。
- provider 返回的最近有效分时日期就是 `tradingDate`。
- 周六打开，如果东财返回 2026-06-05 的完整分时，就写入 `tradingDate=2026-06-05`。

## WatchMarketService Responsibilities

`WatchMarketService` 负责：

- 从缓存中查找可覆盖当前股票列表的最近可用交易日。
- 判断缓存是否完整可靠。
- 缓存不可用时调用 provider 拉取分时和快照。
- 按 provider 返回的 `tradingDate` 写缓存。
- 刷新时保留最近 5 个交易日。

`WatchMarketService` 不负责：

- 计算分时涨跌幅。
- 反推昨收价。
- 解析 provider 原始字段。

## Renderer Behavior

renderer 仍只消费 `WatchMarketData`：

- 股票 quotes。
- 标准化 trends。
- `updatedAt`。
- 是否来自缓存。

renderer 刷新间隔从 15 秒改成 10 秒。是否实际需要拉取、是否使用缓存，由 main process 决定。

## Testing

关键测试：

- `data-calc-helper` 计算分时涨跌幅。
- 东财 provider 从分时数据解析 `tradingDate` 和 `previousClose`，并返回标准化 trend。
- `WatchMarketService` 不再从 quote 反推昨收价。
- 交易时段缓存缺少当前分钟数据时重新拉取。
- 非交易时段缓存未覆盖收盘时重新拉取。
- 周末打开时缓存写入 provider 返回的最近交易日，而不是当前自然日。
- renderer 刷新间隔为 10 秒。

