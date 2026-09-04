# V5.212：常驻 Gateway Agent resolution 与卸载屏障

> 日期：2026-09-04。范围：修复直接 `gateway.resolve()` 与 Host 停止并发时可能产生孤儿 Native Agent handle 的竞态。

## 修复

`DshGateway.cleanupResources()` 现在在关闭 outbound、transport、journal 或快照 owned Agent handles 前，等待所有在途
`resolve()` promise settle。此前，`agents.create()`/`agents.resume()` 若恰在 stop 期间完成，handle 可能在 cleanup 快照后才写入
`ownedHandles`，进而无法被 dispose。新屏障保证 resolution 完成后再统一回收，且 stop 期间新 resolve 继续由已有运行态闸门拒绝。

新增延迟 `agents.create()` 的真实回归：stop 在 Agent 创建尚未释放时保持等待，释放后关闭 journal，并对刚创建的 handle
执行一次 dispose。

## 基线与验证

- canonical DSH `origin/master`：`d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- 产物生成基线：pinned DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为已记录的上游缺陷

本轮开发/验证前重新执行最新 DSH 审计，并用 pinned generator 更新 Gateway Typert digest：

```sh
pnpm run audit:dsh:latest --source <DSH checkout>
DSH_SOURCE_ROOT=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run generate:typert
pnpm --filter dsh-evoforge-gateway test
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：

- Gateway 构建、Typert/Node 产物校验与回归：`51/51` 通过。
- 根级全量检查：权威 `CHECK_RC=0`。
- Evolution `313/313`、Feishu `56/56`、Telegram `38/38`、Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、
  Goal Continuity `12/12`、GitHub Review `27/27`；Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，
  clean-profile `1` 通过/`1` 跳过，其余合同、兼容性、产物与发布脚本门通过。

## 解释边界

本证据只证明本地 Native Agent resolution 的卸载顺序和已审计支持组合上的全量检查；不证明真实飞书/Telegram、真实
Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。
