# V5.208：Candidate 持久化提交时快照

> 日期：2026-09-04。范围：修复 Skill Candidate 仓库在异步 Storage 队列等待期间被调用方修改对象污染的问题。

## 修复

`DomainSkillCandidateStore.recordCandidate()` 与 `recordExistingCandidate()` 现在在进入串行写入队列前复制输入。
排队期间调用方对 `skillName`、描述、Opportunity、谱系或其他字段的修改不会改变 Candidate 内容哈希、候选身份或持久化
证据。复制失败会拒绝该次写入；原有关闭闸门和队列顺序保持不变。

新增真实 DSH Storage 回归：提交 Candidate 后立即修改原始输入，恢复出的 Candidate 仍保持提交瞬间的名称与描述。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为上游缺陷

开发与验证前重新 fetch/audit DSH，随后执行：

```sh
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve exec vitest run test/capability-gap-store.e2e.test.ts --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：

- 类型检查通过。
- Capability Gap durable queue：`6/6` 通过（Candidate 快照回归通过）。
- 根级全量检查：权威 `CHECK_RC=0`；Evolution `312/312`、Gateway `48/48`、Feishu `56/56`、Telegram `38/38`、
  Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、Goal Continuity `12/12`、GitHub Review `27/27`；
  Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，
  其余合同、兼容性、Typert 与产物门通过。

## 解释边界

本证据只证明 Candidate 持久化在提交时捕获输入，以及已审计支持组合上的全量检查；不证明真实飞书/Telegram、真实
Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。
