# ADR-0064：纠正归因必须来自目标回答的唯一持久化 Skill 调用

Skill Opportunity v3 不再用“同 Session 只有一个 Gap Skill 且反馈发生在 Gap 之后”猜测纠正属于哪个 Skill。Host 必须读取 feedback 所指向的原生 durable Session 事件，锁定唯一 assistant message 和同一 turn，确认唯一直接用户消息、唯一成功的 `skill-invocation` 或 `skill` Tool 调用，并折叠出该回答当时的 Goal id/revision；缺失、失败或歧义一律 abstain。持久化只保留有界 Skill/调用/turn/Goal 身份，不复制反馈、消息、Transcript 或 Skill 内容。这个选择会损失一部分无法精确归因的信号，但避免把时间接近误当作 Skill 责任；即使关联精确，`causalClaim` 仍固定为 `none`，且不改变 Opportunity 资格、author 输入或发布权限。
