# V5.210：常驻 Gateway 终态启动闸门

> 日期：2026-09-04。范围：修复 Gateway 在成功停止后再次 `start()` 错误返回成功的问题。

## 修复

`DshGateway.start()` 与 `GatewayOutboundCoordinator.start()` 现在先检查终态 `stopping`，再检查 `started`。一旦
`stop()` 开始，后续启动请求确定性拒绝，不会把已关闭的 journal、transport 或 pairing 资源误报为 ready。健康投影
继续显示 `stopping`，与真实生命周期一致。新增 Gateway 回归覆盖 start → stop → start 的 fail-closed 行为。

本轮第一次根级检查正确发现 Gateway Typert digest 因源文件变化而过期；已用 pinned DSH generator 重新生成并复验。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- 产物生成基线：pinned DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为上游缺陷

开发、产物生成与验证前重新 fetch/audit DSH，随后执行：

```sh
DSH_SOURCE_ROOT=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run generate:typert
pnpm --filter dsh-evoforge-gateway typecheck
pnpm --filter dsh-evoforge-gateway exec vitest run test/gateway.test.ts --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：

- Gateway 类型检查与定向回归：`18/18` 通过。
- 根级全量检查：权威 `CHECK_RC=0`；Evolution `313/313`、Gateway `49/49`、Feishu `56/56`、Telegram `38/38`、
  Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、Goal Continuity `12/12`、GitHub Review `27/27`；
  Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，
  其余合同、兼容性、Typert 与产物门通过。

## 解释边界

本证据只证明常驻 Gateway 的停止终态不会被误报为可重启，以及已审计支持组合上的全量检查；不证明真实飞书/Telegram、
真实 Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。
