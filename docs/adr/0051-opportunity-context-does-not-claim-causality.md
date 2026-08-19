# ADR-0051：Opportunity 关联内部上下文但不冒充因果证据

Skill Opportunity v2 的生成资格仍只来自同一 Workspace、同一缺口 Skill、至少两个不同 DSH Goal 的 Host-confirmed Gap；明确纠正只能在“同 Session 且该 Session 只有一个缺口 Skill”时关联，交付结果只能在“同 Goal id+revision 且该 revision 只有一个缺口 Skill”时关联，并且事件时间不得早于 Gap。关联只保存有界 opaque id 与计数，不复制 correction、消息、Session id、Goal 内容或交付细节；歧义关联直接丢弃，`causalClaim` 固定为 `none`。这些上下文不能单独创建 Opportunity、改变排序/生成资格、进入 author 输入或证明 Skill 导致结果；它们先用于权威 Web 可解释性和后续更强归因设计，直到出现明确 rework/cost/reuse/Retention/rollback 因果接缝。
