# V5.54：Gateway 中断恢复事实接入长期账本

日期：2026-08-27

## 目标

将 resident Gateway 在冷启动时对持久 journal 的真实恢复结果接入 `dsh-evolve` 长期效果账本，避免恢复率
停留在单测或模型自评，并且不让插件加载顺序决定事实是否丢失。

## 实现

- `GatewayOutboundCoordinator.start()` 返回本次从 `sending` 恢复为 `uncertain` 的精确数量。
- `DshGateway.start()` 在恢复前读取 `executing` ingress 与 `sending` outbound，按目标 Workspace 聚合，
  只发出 `{ workspaceId, ingressRecovered, outboundRecovered, observedAt }` 脱敏 Cordis Event。
- Gateway 在进程内保留只读 `recoveryObservations()` 快照。`dsh-evolve` 同时监听 Event，并在自身晚于 Gateway
  加载时重放快照；账本内容寻址保证 Event 与 replay 不会产生重复事实。
- `dsh-evolve` 将每个非零恢复聚合写成 `recovery` fact，触发标记为 `restart`、结果为 `recovered`，不包含
  消息正文、外部身份、凭据或路径。

## 验证

```text
pnpm --filter dsh-gateway typecheck                         # passed
pnpm --filter dsh-evolve typecheck                         # passed
pnpm --filter dsh-gateway exec vitest run \
  test/gateway.test.ts test/outbound.test.ts                # 21 passed
DSH_SOURCE_ROOT=<pinned DSH checkout> \
  pnpm generate:typert                                       # passed
```

Gateway 测试先写入一个 `executing` ingress 与一个 `sending` outbound，再以新 Gateway 冷启动，确认：

```text
evoforge/gateway/recovery emitted       1 workspace-scoped event
ingressRecovered                        1
outboundRecovered                       1
recoveryObservations() replay           exact same observation
```

## 边界

这条事实证明的是 Gateway journal 的可观测恢复，不等于真实飞书/Telegram 多日重连、模型任务恢复或 Hermes
paired benchmark 已通过。没有中断遗留记录时不写“成功恢复”事实；未知或未授权数据继续保持
`not-measured`，release gate 不因此放行。
