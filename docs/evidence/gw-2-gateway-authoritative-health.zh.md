# GW-2：Gateway 自有权威健康投影

> 日期：2026-08-19
> 声明等级：`implemented`；本页只证明当时的 route、原生 Session 与 ingress 投影。公共 outbound
> 后续已由 [GW-3](gw-3-gateway-outbound-delivery.zh.md) 实现；平台 transport 健康和统一 Web 仍未完成。

## 实现事实

- `DshGateway.healthSnapshot(observedAt, routeIds?)` 是同步只读 seam，不调用模型、平台或 Agent 执行；
- lifecycle 区分 `starting`、`ready`、`stopping`；route 输出 id、adapter、Workspace、Session、thread scope
  和原生 Agent 是否 live；同一 Session 被多 route 复用时只计一个 live Session；
- ingress 从既有持久 journal 聚合 `prepared/executing/settled/uncertain`，可按 exact route 子集筛选；
- 未知 route、重复 route 和非法观察时间 fail closed；输出递归冻结；
- 快照不包含 account、conversation/chat、user、消息正文、Command 结果、错误正文、凭据或 Host 路径；
- Host 重启把遗留 `executing` ingress 恢复成 `uncertain` 后，快照明确显示 uncertain，且不会重放外部效果。

## 自动化证据

- TDD 红灯先证明公开 seam 缺失；绿色实现后 `dsh-gateway` 3 files / 10 tests 全部通过；
- 覆盖 before-start、ready、stopping、route 子集、live Session、settled ingress、recovered uncertain、脱敏、
  不可变输出和 fail-closed 参数；
- `pnpm --filter dsh-gateway typecheck` 与 `pnpm --filter dsh-gateway build` 通过。
- Gateway/Telegram/飞书/Evolve Attention 相关回归分别为 10/39/41/18 tests 通过；根目录 `pnpm test`
  全部插件套件通过；
- Doctor 原生插件合同 22/22 通过；十一包 clean-profile add/dump/boot/dispose/remove 1/1 通过，
  用时 26.63 秒。该门只证明包形态和组合未回归，不冒充真实 Host 已调用新健康 seam。

## 后续状态

- Telegram 与飞书 outbound journal、send worker、明确 429 policy 已在 GW-3 迁入 Gateway；本页原始
  自动化数量只记录 GW-2 当时事实，不改写历史；
- 平台连接状态仍由 Adapter 权威持有，Gateway 不伪造 transport ready/degraded；
- Gateway health 尚未生成 DSH Client Remote 或统一 Web 视图；
- 尚未用 packed clean profile 的真实 Host 调用该新 seam，因此声明保持 `implemented`，不升级为 `verified`。
