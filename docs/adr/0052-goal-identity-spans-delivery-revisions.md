# ADR-0052：交付上下文按 Goal 身份跨 revision 关联

固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 的 Goal 是事件溯源对象：`id` 在整个 Goal 生命周期稳定，每次 `edit/pause/resume/block/complete` 都递增 `revision`。`complete_delivery` 在验证通过后调用原生 `update_goal complete`，因此结果携带的是完成后的新 revision；Capability Gap 则携带缺口发生时的较早 revision。要求两者 revision 完全相等会系统性漏掉成功交付，不能代表同一 Goal 的真实经历。

Opportunity 的交付上下文改为按同一 Workspace、同一 Goal id 关联。该 Goal 的全部已知 Gap 必须只涉及一个 Skill；Outcome 必须发生在至少一条该 Skill Gap 之后，且 Outcome revision 不得早于那条 Gap revision。任一条件不满足就 abstain。Outcome 仍只是 `causalClaim: none` 的上下文，不能创建 Opportunity、改变两独立 Goal 资格、进入 author 输入、证明缺失 Skill 导致结果或授权 Candidate/晋升。

这使正常的 `gap@revision N → complete@revision N+1` 可见，同时拒绝旧 revision、跨 Workspace、多 Skill Goal 和时间倒序记录。同一 Goal 的多次 Outcome 仍不算多份发现资格，也不冒充返工、复用或改进证据。
