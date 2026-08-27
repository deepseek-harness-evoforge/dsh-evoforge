# V5.66：渠道传输活动可观测性

## 修正

原生 DSH Control Center 的 `渠道` Surface 在每个 Adapter 的技术详情中显示 Host 已记录的连接时间、最近活动时间和最近错误时间。
这三个字段只来自 Gateway transport observation；没有新增平台探测、API 请求、凭据读取或模型调用，也不把 `ready` 误写成“已收到业务事件”。

当 WebSocket 已 `ready` 但平台没有送入新事件时，管理员可以在同一页面直接看到“最近活动”仍未更新；发生连接或发送错误时，
“最近错误”与连接状态分开显示。时间为空时明确显示“尚无记录”，避免把旧快照误认为当前活动。

## 验证

- `pnpm --filter dsh-gateway typecheck` 通过。
- `pnpm --filter dsh-gateway test`：8 个测试文件、36 项测试全部通过；浏览器组件测试同时覆盖“无活动/无错误记录”的明确空值呈现。
- `pnpm check:docs` 与 `git diff --check` 通过；现有单页 Control Center、pending 自动轮询和真实发布门状态不变。

## 边界

活动时间只能证明 Adapter 向 Gateway 报告过 transport activity，不能证明 Feishu 后台事件订阅已开启、消息已获授权、Agent 已执行或回复已送达。
真实 Feishu AS-2 仍必须通过真实事件、消息、Schedule、Approval、重启、卸载和 Session readback 的完整 terminal epoch。
