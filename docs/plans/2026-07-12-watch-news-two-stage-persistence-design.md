# 持仓股消息两阶段持久化设计

## 目标

权威公告候选抓取成功后立即保存并通知界面，不等待 AI 分析或同批其他股票；AI 完成后原位升级同一条消息，不产生重复记录。

## 模块边界

- `CodexWatchNewsAnalysisProvider` 负责来源抓取和 AI 分析。它通过部分结果回调发出已筛选的重要公告草稿，但不直接访问消息存储或 Electron 窗口。
- `WatchNewsService` 负责流程编排。收到部分结果后立即调用 store，并通过消息变更回调通知 main 进程；每只股票独立执行，不经过批量结果屏障。
- `WatchNewsStore` 负责去重和原位升级。相同 `dedupeKey` 的 AI 完整结果替换“AI 分析未完成”的保底内容，同时保留消息 id、首次获取时间和已读状态。
- Main 进程把 service 的消息变更回调转成现有 `watch-news:updated` 事件；renderer 继续复用 `refreshNewsState()`，不新增展示层协议。

## 数据时序

1. provider 拉取东方财富公告候选并筛选重要公告。
2. provider 调用 `onPartialDrafts(fallbackDrafts)`。
3. service 立即持久化并广播，renderer 刷新后显示感叹号和消息。
4. provider 在后台继续等待 Codex 完成、失败或超时。
5. 模型结果返回后，service 再次写入；相同消息原位升级，其他媒体消息正常新增。
6. 批量分析中的其他股票不会阻塞已经产生部分结果的股票。

## 失败策略

- 模型失败或软件随后关闭，不影响已经完成的公告持久化。
- 公告候选为空时不会产生保底消息。
- AI 返回与保底消息相同的来源链接或标题时只保留一条，并升级分析内容。

