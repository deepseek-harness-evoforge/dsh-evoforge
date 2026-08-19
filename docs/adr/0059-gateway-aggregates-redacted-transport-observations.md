# ADR-0059：Gateway 聚合脱敏 Transport Observation

Telegram 长轮询和飞书官方 WebSocket 都需要向运维面回答同一组问题：连接正在建立、可用、退化还是停止，最近何时成功活动、何时观察到错误。若这些事实只保留在 Adapter 私有字段和各自 Command 中，DSH Web 无法形成统一渠道视图，也无法按 exact route 比较或隔离 Workspace；若把 SDK、重连和错误分类整体移入 Gateway，又会把薄 Host seam 扩成巨型 Bot Runtime。

因此 `dsh-gateway` 增加独立 `GatewayTransportRegistry`。Adapter 仍拥有平台协议、连接、重连、凭据和错误处理，只以 exact adapter/account/routeIds 注册一个 transport kind，并上报 `connecting/ready/degraded/stopping` 与脱敏时间事实。Gateway 校验该 account 对 route 的静态所有权、拒绝重复注册和时间倒退，`healthSnapshot()` 只按调用者选择的 exact routes 返回相交 route id、transport kind/state 和时间；不返回 account/chat/user、错误正文、消息、external id 或凭据。

Telegram 已在真实 assembled DSH 长轮询中验证一次失败进入 `degraded`、下一次成功恢复 `ready`；飞书已验证官方 transport error 进入 `degraded`、后续平台消息恢复 `ready`。飞书 `/feishu` 与既有 DSH Web 健康视图改为读取 Gateway transport/outbound 权威投影，不再直接把 Adapter 私有状态作为读模型。统一 Gateway Web 后续已由 [ADR-0060](0060-gateway-web-is-a-read-only-host-projection.md) 实现和真实浏览器验证；本决策不因此声明真实渠道闭环完成。
