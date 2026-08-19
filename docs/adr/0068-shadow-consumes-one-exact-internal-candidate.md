# Shadow consumes one exact internal Candidate

`dsh-evolve` 的 Shadow 边界只接收已经由内部经验慢环形成、内容寻址并通过前置治理的 exact Candidate。调用者必须提供 Candidate 目录、内容哈希、tree hash、lineage 和声明为 DSH assembled 的 Trial；缺失、漂移或不一致一律 fail closed。Shadow 不搜索来源、不读取 Git repository/ref、不接受静态 Skill/Case Pack target、不生成 Feedback Case Draft 或 Evaluator Draft，也不在执行时调用 proposer 临时决定“要改什么”。

Candidate 作者、评测治理和执行面保持分离：作者只消费被分配的内部 authoring 证据；治理面独占 admission/holdout；Shadow 只执行 exact Candidate 对照。当前 Session 固定已有版本，Shadow 结果最多进入 Review/Generation 边界，不能自行安装、激活或改变当前 Session。

因此，旧的 `feedbackDraftRoot`、`shadowTargets`、`evaluatorTargets`、Feedback-guided Shadow、Evaluator Draft、静态 Retention/counterfactual-canary 编排和自动 review expiry 不再是当前运行时合同。相关旧 ADR 与证据仅保留为历史决策记录，不能作为重新启用这些接口的依据。Retention、反事实 canary 和低风险自动晋升若重新进入活动路径，必须直接绑定内部 Opportunity、Evidence Seal、Candidate、Evaluation Envelope 和真实 Outcome，并重新通过负迁移、安全、成本、恢复与回滚门禁。
