# ADR-0093：精确 Skill 结果上下文是时间关联，不是因果归因

- 状态：accepted
- 日期：2026-08-21
- 关联：[ADR-0092](0092-skill-reuse-is-bound-to-exact-content-generation-and-goal.md)、[ADR-0053](0053-delivery-outcomes-project-from-durable-session-log.md)、[ADR-0052](0052-goal-identity-spans-delivery-revisions.md)
- 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 背景

V4.50 能证明同一个 exact Skill 版本跨 Goal 被真实调用，但调用次数没有交付结果语义。直接把之后的
`complete_delivery` 统计成 Skill 成功率，又会把 Goal 难度、其他 Tool、人工纠正和环境变化错误归因给 Skill。
EvoForge 已分别持久化 exact Skill Use 与 Delivery Outcome，不需要另建结果事件源或新的 Goal 状态。

## 决策

1. `Exact Skill Outcome Context` 只投影已跨至少两个不同 Goal 的 exact Skill name、invocation-content hash 与
   Generation。每个 Goal 上下文再以原生 Session id 和稳定 Goal id 区分，但 Control/Remote/Web 不下发这两个 id。
2. 只关联同 Session、同 Goal、同 Generation，且发生时间不早于第一次 exact use、Goal revision 不早于该 use
   的 durable Delivery Outcome。旧 revision、跨 Session、跨 Generation、时间倒序和无结果均不猜测。
3. 一个 Goal 的所有合法 Outcome 都保留为 attempt 数；唯一最新事实为 `passed` 且此前存在非 `passed` 时，
   只描述为 recovered。相同最新时间存在多个结果时标记 ambiguous，并拒绝给出最新状态、恢复和最新指标。
4. 指标只读取唯一最新 Outcome 自带、且 goal id 精确一致的 DSH Goal metrics；缺失即 unmeasured。货币成本继续
   明示 provider price 未投影，不根据 token 猜价格。
5. Workspace/selected/baseline rollup 统计全部 exact 版本，明细按确定性顺序最多显示 20 行。所有输出固定
   `attribution: same-session-goal-generation-after-use`、`causalClaim: none`、`improvementClaim: none` 与
   `releaseAuthority: none`，不得进入 Candidate 资格、评分、晋升或回滚决策。
6. 这是两个独立 DSH StorageDomain 的只读 Host 投影。当前 Session 仍固定 Generation；不新增 Store、Session、
   Goal、Agent Runtime、审批或模型调用。

## 后果

- 用户可以看到 exact 跨 Goal 版本之后有多少 Goal 得到持久结果、多少次交付尝试、是否出现后续恢复，以及
  最新结果对应的 token、cache 和时延；刷新和冷启动从同一权威事实恢复。
- “恢复”仍只是事件顺序描述，不能写成 Skill 导致恢复、减少返工或提升成功率。
- 真正的效果估计仍需同任务、同模型、同权限、同预算的 paired baseline、未见样本、负迁移/遗忘和长期结果；
  本投影不能解除任何发布门禁。
