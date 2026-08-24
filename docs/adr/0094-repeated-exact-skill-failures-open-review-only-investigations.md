# ADR-0094：重复的精确 Skill 最新失败只开启审查调查

- 状态：accepted
- 日期：2026-08-24
- 关联：[ADR-0093](0093-exact-skill-outcome-context-is-temporal-not-causal.md)、[ADR-0053](0053-delivery-outcomes-project-from-durable-session-log.md)
- 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 背景

V4.50–V4.52 已能从 DSH 原生持久事实显示 exact Skill 的跨 Goal 复用、后续交付结果与尝试间新增工作，但失败仍只是一组被动数字。直接按失败次数生成 Candidate 会把同一 Goal retry、后来恢复、结果冲突、任务难度和其他 Tool 影响误判为 Skill 缺陷；完全不形成调查又无法把重复跨 Goal 失败转化为可行动的自我发现线索。

## 决策

`Exact Skill Failure-Context Investigation` 复用既有只读 `Exact Skill Outcome Context`，不新增 Store、队列、Session、Goal 或 Runtime。只有同一 Skill name、invocation-content hash 与 Generation 在至少两个不同 Goal 上都存在唯一最新 `failed` Outcome 时，才标记 `eligible-for-review`；同 Goal 多次失败只算一个，后来唯一最新为 passed/recovered 的 Goal 不算，missing、unknown、并列冲突与顺序歧义均 abstain。新 Outcome 可让该调查自动撤回。

调查只请求后续因果复核，固定 `causalClaim: none`、`candidateAuthority: none`、`releaseAuthority: none`，不得直接生成或排序 Candidate，不得触发晋升、回滚或发布。全量 rollup 保持完整；有界明细先显示 eligible 行，避免 20 行上限隐藏需要复核的内部信号。

## 后果

DSH Command 与 Web 可以把重复跨 Goal 最新失败显式呈现为调查入口，同时保留“时间关联不等于 Skill 导致失败”的边界。真正的 existing-Skill Candidate 仍必须经过精确纠正归因、完整 baseline Bundle、生成前证据密封、独立 Holdout/Retention 与发布门；真实 provider、长期负迁移和 Hermes paired benchmark 门禁不变。
