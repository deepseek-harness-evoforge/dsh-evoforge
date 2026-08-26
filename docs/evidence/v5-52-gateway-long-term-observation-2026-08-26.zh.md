# V5.52：Gateway 出站终态接入长期效果账本

日期：2026-08-26

## 交付内容

`dsh-gateway` 的 `GatewayOutboundCoordinator` 现在在 journal 写入终态后发出一个 Host-only
`evoforge/gateway/outbound` 事件。事件只包含 Workspace/route 的非敏感身份、内容寻址的 intent 与
operation hash、`applied`/`unknown` 结果、尝试次数和观测时间，不包含消息正文、外部会话标识或凭据。

`dsh-evolve` 订阅同一个事件并写入 `evoforge_long_term_effects` 的 `external-effect` 事实：Gateway
明确 `delivered` 才记为 `applied`，`uncertain`/`failed` 保持 `unknown`。写入失败只记录 Host warning，
不会改变发送结果或重试状态；Context 卸载会按既有 DSH effect 顺序清理。

## 边界

多次 `submit` 的幂等命中、retry 次数和同一 intent 的恢复都不是“重复外部效果”。只有 Adapter/平台
明确提供同一 operation/idempotency key 的 `duplicateOfFactId`，长期投影才会计入 duplicate；因此该
事件接入会增加真实 applied/unknown 覆盖，但不会伪造 duplicate、因果或发布结论。

Gateway 与 dsh-evolve 通过 Cordis Event 合同解耦，未新增 Session、Goal、Agent Runtime、Gateway
旁路或跨包强依赖。dsh-gateway 的 Host Typert 事件和 dsh-evolve 的监听合同均已按当前 pinned DSH
生成物刷新。

## 验证

```text
pnpm --filter dsh-gateway exec vitest run test/outbound.test.ts  # 10 passed
pnpm --filter dsh-gateway build                               # Typert/node artifact verifier passed
pnpm --filter dsh-evolve typecheck                             # passed
pnpm check:docs                                                # passed
```

真实 Feishu/Telegram 长期重连、同任务同模型 Hermes paired 以及 duplicate-of 平台事实仍未授权，
所以 `release-gates.json` 的 long-term-effects 门继续是 `not-run`。

