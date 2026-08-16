# ADR-0016：自动回滚必须先通过同 Case Pack 反事实门

## 状态

Accepted，2026-08-16。

## 决策

`dsh-evolve` 把失败的 Delivery Outcome 只当作复测触发器。只有同时满足以下事实，才允许把
future-session active pointer 从自动晋升的 Candidate 回到其精确父版本：

1. Outcome 来自该 Session 固定的、`auto-clear-instruction-v1` Generation；
2. 原 Shadow run、Case Pack hash、evaluator epoch 与 reviewed evidence 完全一致；
3. Candidate 和 parent 都从不可变 Git commit/tree 物化，内容 hash 分别等于原 review；
4. known-bad / known-correction 校准通过；
5. 同一 Sealed Trial 中 parent 通过而 Candidate 失败；
6. Trial 结束时 active pointer 仍指向该 Candidate。

Candidate 仍通过则保持；校准失败、parent 也失败、证据/epoch 漂移或 active pointer 已变化则只写
`review`，不自动移动指针。Originating Session 从不等待 canary，已有 Session 也不随 rollback
漂移。Capability rollback 不能撤销已经发生的外部效果。

Canary 是 `dsh-evolve` 内部一个深 Module，不发布新的插件、Tool、Prompt、daemon、Goal 或状态
平台。复测由已有 resident supervisor 扫描触发，作为原生 DSH `evolution` Job 运行并复用原
Case Pack；不调用 proposer，不产生新 Candidate。同一不可变 Generation 最多消费第一条匹配失败
并运行一次 canary，避免失败数量把相同四次 Trial 放大。run-local journal 在 Trial 前和 pointer
write 前持久化，崩溃后以 active pointer 为准补齐，保证不重复回滚。

## 理由

一次交付失败无法区分 Skill 回归、业务代码错误、测试基础设施故障或外部服务异常。按失败计数
回滚会制造振荡和误伤；重新发起模型反思又会增加 token、引入不确定性，并破坏证据独立性。
相同 evaluator、相同 Case Pack、exact parent/Candidate 的反事实比较是当前最小、可解释且可归因
到 retained-case regression 的门。它不声称重放或归因那一次真实开发任务；Outcome 只决定何时
做健康复测。要归因新型真实失败，必须先有另行授权、可脱敏且可重放的 task case，不能从短 reason
或一次模型反思中猜出来。

## 代价与边界

- 每个自动晋升 Generation 最多增加四次本地 Sealed Trial 的 CPU/时延；提案模型 token 增量为 0。
- macOS 当前有 fail-closed Seatbelt executor；其他平台不会伪造 canary 结论。
- 原 Case Pack 被修改或删除时无法回放，只进入人工复核。
- 当前只发现原 retained Case Pack 上重新出现的回归；不覆盖 Case Pack 未表示的新型真实失败。
- 这能阻止证据不足的自动回滚，不能证明长期 false-promotion/false-rollback rate；生产多日数据
  仍是后续退出门。
