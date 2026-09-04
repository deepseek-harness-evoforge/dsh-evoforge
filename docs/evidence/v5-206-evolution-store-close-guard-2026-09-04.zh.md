# V5.206：自进化持久化仓库关闭闸门

> 日期：2026-09-04。范围：修复 Generation 与 Existing-Skill Release Storage 在关闭后仍接受写入的问题。

## 修复

`DomainEvolutionStore` 的全部写操作（发布、晋升、回滚、暂停、Session pin 和回退到原生）现在经过统一的关闭闸门；
`DomainExistingSkillReleaseStore.record()` 也经过同一类串行队列。调用 `close()` 后，新写入会立即以可诊断错误拒绝，
而已经排队的写入仍按原有顺序完成后再关闭 DSH Storage domain。这样卸载、故障恢复和精确回滚不会把新状态写入已关闭的域。

新增真实 DSH Storage 回归，覆盖两个仓库在关闭后的写入拒绝，并验证重复 `close()` 可安全调用。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为上游缺陷

开发前重新 fetch/audit DSH，随后执行：

```sh
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve exec vitest run test/generation-store.e2e.test.ts --maxWorkers 1
```

结果：

- 类型检查通过。
- Capability Generation Storage：`11/11` 通过（含关闭后拒绝写入回归）。
- DSH latest audit：安装通过、根构建按上游缺陷分类为 blocked；未修改或掩盖 DSH 上游状态。

随后在已审计的 alpha.5 支持组合上执行根级 `pnpm run check`，权威 `CHECK_RC=0`：Evolution `310/310`、Gateway
`48/48`、Feishu `56/56`、Telegram `38/38`、Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、Goal
Continuity `12/12`、GitHub Review `27/27`；Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，
clean-profile `1` 通过/`1` 跳过，其余合同、兼容性、Typert 与产物门通过。

## 解释边界

本证据只证明两个核心自进化持久化仓库的关闭边界和本地 DSH Storage 恢复路径，以及在已审计支持组合上的全量本地检查；
不证明真实飞书/Telegram、真实 Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。
