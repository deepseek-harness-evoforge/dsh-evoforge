# ADR-0051：Feedback Draft 的 Skill 必须由 durable invocation 推导

## 状态

Accepted，2026-08-19。

## 背景

ADR-0018 正确要求用户逐条授权把 reference-only 负反馈复制到私有 Case Draft，但旧命令同时要求
用户输入目标 Skill：`/evolve feedback <signal-id> draft <skill>`。这把本可由 DSH 原生 Session 证明的
归因重新交给用户，既可能选错，也与“系统从自身运行经历发现应改进哪个 Skill”的目标冲突。

Feedback 仍可能包含私有用户原文和 correction，因此不能因自动归因而取消逐条复制授权。

## 决策

公共动作改为 `/evolve feedback <signal-id> draft`，不接受 Skill 名。Builder 在任何 Git 读取或写盘前
重新读取当前 Message Feedback、pinned Generation 和完整 durable Session prefix，并要求：

- feedback version 仍完全一致，且仍为带非空 note 的负反馈；
- 目标 assistant message 唯一，且存在 exact turn boundary；
- 该 turn 恰好包含一条直接用户纯文本消息和一条 `skill-invocation`；
- invocation 的 Skill 名合法，且 pinned Generation 恰好包含一个同名 immutable artifact；
- artifact 按 exact commit/tree 完整性物化后，才允许形成内容寻址草稿。

零次或多次 Skill invocation、非法 invocation identity、Generation 不含该 Skill、反馈漂移或 Session
歧义全部 fail closed。用户只授权“复制这条反馈的最小私有样本”，不再选择目标 Skill；命令结果显示
由 durable invocation 推导出的 exact Skill，便于核查。

这项决定不自动复制反馈、不调用模型、不生成 Candidate、不建立新 Session/Case 权威，也不让纠正
直接成为 evaluator 或晋升证据。`feedbackDraftRoot` 与逐条 command 仍是两层 Protected Action。

## 结果

- Skill 归因从用户输入移回 DSH 自己的可验证运行事实；
- 私有数据披露仍需明确逐条授权；
- 多 Skill turn 继续 abstain，不用启发式猜测；
- 该 seam 可在后续作为“exact invocation correction evidence”的来源，但本 ADR 本身不宣称已完成
  Opportunity、独立评测或自动晋升闭环。
