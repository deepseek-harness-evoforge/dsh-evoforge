# V5.209：演化证据输入提交时快照

> 日期：2026-09-04。范围：为 Gap、Feedback、Skill-use、Delivery-outcome 和 Long-term-effects Storage 增加输入快照，
> 防止异步持久化期间的调用方修改污染自进化证据。

## 修复

五类证据仓库在进入串行写入队列前复制输入；排队期间对 Goal、Skill、反馈、归因、指标或状态对象的修改不再改变持久化
事实或其内容身份。复制失败会拒绝该次写入，已有关闭闸门和串行写入顺序保持不变。新增真实 DSH Storage 回归覆盖 Gap、
Feedback 和 Delivery 三条证据链；Candidate 的独立快照回归也继续通过。

本轮第一次根级检查发现 `dsh-evolve` 生成 Typert digest 过期（源文件属于 digest 覆盖范围），已使用 pinned DSH alpha.5
generator 重新生成 `lib/typert.source.sha256` 后复验；该失败被记录而未被掩盖。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- 产物生成基线：pinned DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为上游缺陷

开发、产物生成与验证前重新 fetch/audit DSH，随后执行：

```sh
DSH_SOURCE_ROOT=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run generate:typert
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve exec vitest run test/capability-gap-store.e2e.test.ts test/skill-use-store.e2e.test.ts test/delivery-outcome-store.e2e.test.ts --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：

- `dsh-evolve` 类型检查通过；3 个证据套件 `10/10` 通过。
- 根级全量检查：权威 `CHECK_RC=0`；Evolution `313/313`、Gateway `48/48`、Feishu `56/56`、Telegram `38/38`、
  Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、Goal Continuity `12/12`、GitHub Review `27/27`；
  Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，
  其余合同、兼容性、Typert 与产物门通过。

## 解释边界

本证据只证明本地证据输入的提交时一致性及已审计支持组合上的全量检查；不证明真实飞书/Telegram、真实 Provider、
Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。
