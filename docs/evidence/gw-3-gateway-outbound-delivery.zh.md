# GW-3：Gateway 公共出站投递深模块

> 日期：2026-08-19
> 声明等级：`implemented`。本证据证明 Telegram 与飞书在真实 DSH 组装测试中共用一个 Gateway
> outbound authority；不冒充真实 Telegram/飞书公网账号、统一 Web 渠道控制面或 exactly-once 证明。

## 纠正与删除

迁移前两个 Adapter 各自维护近似相同的 Delivery Store、状态机、重试队列和恢复逻辑。这让
`prepared/sending/retrying/delivered/uncertain/failed` 有三个潜在权威，也让 Gateway 的“持久投递、幂等、
重试、限流和诊断”只停留在文档。当前增量没有双写或兼容转发：直接删除 Telegram、飞书各自的
`delivery-store.ts`、`delivery-state.ts` 和对应私有测试，移除 Adapter 对 `storageDomain` 的直接依赖，
由 Gateway Storage Domain `evoforge_gateway_outbound` 成为普通文本出站唯一持久权威。

## 公共合同

- Adapter 只注册 exact `adapter/accountId/routeIds`，Gateway 逐条验证 route 归属；公开面只有
  `submit(intent)` 与 `dispose()`；平台 SDK、凭据、
  实际 send、错误归类、卡片和 Approval UI 不进入 Gateway；
- intent 只包含 exact route、`turn/response/notice`、稳定 intent key、有界正文、可选 reply identity/thread
  语义，以及仅 turn 可用的原生 `turn/end` 门；
- Gateway 在外部 effect 前依次持久化 `prepared`、`sending`；相同 route + intent key 重放返回原记录，
  内容或目标漂移拒绝；Adapter/account 内串行发送；
- 只有平台明确证明的 pre-acceptance rate limit 才按 Adapter policy 有界重试；模糊结果、抛错和崩溃中的
  `sending` 均进入 `uncertain`，禁止自动重复外部效果；
- journal 只淘汰最旧终态；活跃记录占满时 fail closed；健康面按 exact route 投影 registration、scheduled、
  六态计数和最近意图元数据，不输出 account/chat/user、正文、reply/external message id、错误或凭据；
- Gateway 不实现全局 token bucket，不推断平台配额，不承诺 exactly-once。平台 transport
  `ready/degraded` 仍由 Adapter 权威持有。

## TDD 与自动化证据

红灯先把 Telegram 与飞书真实 DSH assembled 测试改为只接受 Gateway outbound Domain，并断言旧
`evoforge_telegram`/`evoforge_feishu` Domain 不存在；旧实现按预期失败。绿色实现后：

| 范围 | 结果 | 覆盖 |
|---|---:|---|
| `dsh-gateway` | 4 files / 17 tests | 明确 429→成功、重复不重发、turn/end 门、重启后原生 turn/end 唤醒及竞态、崩溃 `sending→uncertain`、畸形 Adapter success 降级、意图漂移、非法 key、活跃容量、exact route registration、脱敏健康 |
| `dsh-telegram` | 7 files / 26 tests | 真实 DSH Agent/Command/Approval/Goal continuation、Gateway journal、重复入站、安装卸载 |
| `dsh-feishu` | 13 files / 31 tests | 真实 DSH Agent/Command/Approval/Goal continuation、429 两次尝试、Gateway journal、健康、配对 Client |

三包 typecheck 通过；Gateway build、Telegram build、飞书 Host/Client build 通过。随后全仓
`pnpm check` 通过：文档、11 包 typecheck、全部插件测试与 11 包 build 均为绿色。完整 composition
Cache Contract 通过，包含 64 轮稳定 Gap Tool、GitHub review、Goal cold resume、packed Delivery、双渠道
请求 byte parity 和 Doctor 22/22。十一包 clean-profile tarball add/dump/boot/原生 Agent+Goal+Tool/
remove/reboot/readback 1/1 通过；exact routeIds、畸形 Adapter success 保守降级等最终 fail-closed
修订后的完整复验用时 26.89 秒。

## 未完成门禁

- 尚未用真实 Telegram Bot 或真实飞书 exact route 验证公网发送、平台限流和多日重连；
- Gateway transport 聚合与 DSH Web 统一渠道视图后续已由 [V5.1](v5-1-gateway-transport-health.zh.md)
  和 [V5.2](v5-2-gateway-web-health.zh.md) 补齐；
- 飞书文件、文档、知识库、云盘和多维表格的独立权限能力仍未交付；
- 本增量不证明内部 Candidate 独立评测、真实 provider 或 Hermes paired 上位结果，不允许打 tag。
