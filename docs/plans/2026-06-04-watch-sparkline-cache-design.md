# 盯盘脑图走势与本地数据目录设计

## 目标

在“盯盘脑图”的股票节点旁增加实时走势曲线和涨跌幅数字。曲线打开即可展示当日已有走势，后续随行情刷新更新。所有用户配置、脑图、走势缓存和调研运行数据统一保存到软件根目录下的 `user_data/`。

## 范围

包含：

- 股票节点名称右侧显示小型走势曲线。
- 走势曲线中间显示零轴虚线。
- 高于零轴的走势线显示红色，低于零轴显示绿色。
- 走势曲线右侧显示最新涨跌幅百分比数字。
- 打开脑图时优先读取同日本地缓存，避免同一天每次启动都重新拉取初始走势。
- 隔日启动时丢弃旧行情缓存并拉取新一天数据。
- 所有用户业务数据保存到软件根目录的 `user_data/`。

暂不包含：

- 多日历史走势回放。
- 走势曲线交互缩放。
- 交易所认证行情或交易功能。

## 用户数据目录

应用不再使用 Electron 默认 `app.getPath("userData")` 保存业务数据。主进程启动时解析软件根目录，并在其下创建：

```text
user_data/
```

保存内容包括：

- `user_data/config.json`
- `user_data/history.json`
- `user_data/stock_research_spec.md`
- `user_data/watch-tree.json`
- `user_data/watch-quotes-cache.json`
- `user_data/runs/<run-id>/report.md`
- `user_data/runs/<run-id>/events.jsonl`
- `user_data/runs/<run-id>/stderr.log`
- `user_data/runs/<run-id>/.agents/skills/research-a-share-stock/`

PDF 仍保存到用户选择的报告目录。

在开发模式下，软件根目录是项目目录。打包后，软件根目录是 `A股调研助手.exe` 所在目录。若 `user_data/` 无法创建或不可写，应用显示明确错误，阻止需要写入的调研和盯盘操作，不静默回退到系统 `AppData`。

## 行情与走势缓存

新增本地缓存文件：

```text
user_data/watch-quotes-cache.json
```

缓存按中国本地日期记录：

```ts
interface WatchQuotesCache {
  tradingDate: string; // YYYY-MM-DD
  quotes: StockQuote[];
  trends: StockTrend[];
  updatedAt: string;
}
```

打开“盯盘脑图”时：

1. 主进程读取 `watch-quotes-cache.json`。
2. 若 `tradingDate` 是今天，直接返回缓存数据给 Renderer 渲染，不立即重新请求初始走势接口。
3. 若缓存缺失或不是今天，主进程拉取当天走势和最新快照，写入新缓存。
4. 后续每 15 秒刷新最新快照，并将最新涨跌幅点合并进当天走势缓存。

如果今天已有缓存但刷新失败，界面继续显示缓存数据，并在状态栏提示刷新失败。若今天没有缓存且接口失败，股票显示“暂无行情”，不伪造数据。

## 走势数据

新增类型：

```ts
interface StockTrendPoint {
  time: string;
  price?: number;
  changePercent: number;
}

interface StockTrend {
  secid: string;
  points: StockTrendPoint[];
  fetchedAt: string;
  errorMessage?: string;
}
```

主进程行情服务新增分时接口解析能力。东财分时记录本身提供价格、成交量、成交额和均价，不直接提供涨跌幅；应用保存每个分时点的价格，并用最新快照中的价格和涨跌幅反推出昨收价，再计算分时点涨跌幅。打开脑图时拉取当日分时走势；后续 15 秒刷新时使用最新快照补点。收盘后同一天再次打开软件时，优先展示缓存中的完整当日走势。旧版本生成的同日缓存若缺少分时价格，会被视为不可用并重新拉取。

## Renderer 展示

股票节点结构变为：

```text
[股票名称] [走势曲线] [涨跌幅]
```

分类节点保持现有紧凑显示，不展示曲线。

走势使用小型 SVG：

- SVG 中间绘制零轴虚线。
- 折线按相邻点是否高于或低于零轴分段着色。
- 正区间使用红色，负区间使用绿色。
- 无走势数据时显示空白零轴，不显示虚构线。

涨跌幅数字使用最新快照：

- 大于 0：红色。
- 小于 0：绿色。
- 等于 0 或无数据：灰色。

## IPC

现有 `getWatchQuotes(secids)` 保留给手动刷新快照使用。新增或替换为缓存感知接口：

- `getWatchMarketData(secids)`：读取同日缓存；必要时拉取初始走势和快照；返回 quotes 和 trends。
- `refreshWatchMarketData(secids)`：主动刷新快照并合并走势缓存。

Main Process 对 `secids` 参数继续使用 `validateSecid()` 校验。Renderer 不直接访问文件系统，不直接联网。

## 测试

自动化测试覆盖：

- `user_data/` 根目录解析和不可写错误。
- 同日缓存命中时不调用行情接口。
- 隔日缓存失效时重新拉取行情。
- 分时走势解析正负涨跌幅点。
- 快照刷新会合并最新点并写回缓存。
- SVG 走势渲染包含零轴、红色正区间、绿色负区间。
- 无走势数据时不伪造线。
- IPC 拒绝非法 `secid` 参数。

Windows 手工验收增加：

- 打开脑图即可看到股票节点右侧走势和涨跌幅。
- 同日关闭并重新打开软件，优先显示缓存曲线，不重新拉取初始走势。
- 隔日打开软件后重新拉取新一天走势。
- `user_data/` 位于软件根目录，包含脑图和走势缓存文件。
