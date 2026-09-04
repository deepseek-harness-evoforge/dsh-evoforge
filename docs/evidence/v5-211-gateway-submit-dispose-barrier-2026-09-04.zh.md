# V5.211：常驻 Gateway 出站提交与卸载屏障

> 日期：2026-09-04。范围：修复 resident Gateway 在出站 `submit()` 尚未完成 journal prepare 时发生
> Adapter dispose/Host 卸载的生命周期竞态。

## 修复

`GatewayTextAdapterRegistrationImpl.submit()` 现在在进入校验前登记为活跃提交，并在所有异步路径结束时释放登记。
`dispose()` 先中止新的发送调度，再等待活跃提交完成，最后等待发送队列并执行资源回收。这样，已经进入的提交不会在
`outbound journal` 关闭后才写入；dispose 开始后才到达的提交会 fail-closed，不会产生迟到的持久化副作用。

新增真实 journal 延迟回归：人为阻塞 `prepare()`，确认 dispose 在提交释放前不会完成；释放后提交得到 durable
`prepared` receipt，dispose 才完成，且不会启动外部发送。

## 基线与验证

- canonical DSH `origin/master`：`d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- 产物生成基线：pinned DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为已记录的上游缺陷

本轮先执行最新 DSH 审计，再运行 Gateway 定向测试。第一次构建被正确的 Gateway Typert stale-digest 门阻断，随后使用
固定 DSH generator 重新生成 `packages/dsh-gateway/lib/typert.source.sha256` 并重跑：

```sh
pnpm --filter dsh-evoforge-gateway test
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：

- Gateway 构建、Typert/Node 产物校验与回归：`50/50` 通过。
- 根级全量检查：权威 `CHECK_RC=0`。
- Evolution `313/313`、Feishu `56/56`、Telegram `38/38`、Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、
  Goal Continuity `12/12`、GitHub Review `27/27`；Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，
  clean-profile `1` 通过/`1` 跳过，其余合同、兼容性、产物与发布脚本门通过。

## 解释边界

本证据只证明本地 DSH Storage journal 与 resident Adapter teardown 的顺序边界，以及已审计支持组合上的全量检查；不证明
真实飞书/Telegram、真实 Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。

