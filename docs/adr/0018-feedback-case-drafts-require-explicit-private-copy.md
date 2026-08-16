# ADR-0018：反馈 Case Draft 必须显式授权并私有落盘

## 状态

Accepted，2026-08-16。

## 背景

P1.3 的 `Explicit Feedback Signal` 故意只保存引用，不复制反馈备注或消息正文。这能安全回答
“哪里有一条当前负反馈”，却不能给后续 evaluator 提供最小复现输入。直接自动复制完整 Transcript
会带来三个问题：可能包含秘密或无关私有内容；一个 turn 可能调用多个 Skill，归因模糊；后台观察
本来不阻塞会话，却会悄悄扩大持久数据范围。

项目需要一个比通用 Memory/Case 平台更窄的接缝，把用户明确选择的一条纠正变成可检查的本地
草稿，同时诚实保留“尚未评测”的状态。

## 决策

`dsh-evolve` 只在同时满足两次显式授权时创建 `Feedback Case Draft`：

1. 管理者配置一个本地 `feedbackDraftRoot`，表示允许把最小原文复制到该私有目录；
2. 用户执行 `/evolve feedback <signal-id> draft <skill>`，逐条选择反馈和目标 Skill。

Builder 只有一个动作 `create(signalId, skillName)`，不发布通用 Case/Signal runtime interface。
创建前必须重新读取 DSH 原生 Message Feedback 和 Session Persistence，并逐项 fail closed：

- feedback 仍是同一个 opaque version、负向且 note 非空；
- Session 生命周期仍绑定信号记录的 exact pinned Generation；native DSH signal 不生成草稿；
- durable history 中只有一个目标 assistant message、一个直接用户纯文本消息，以及恰好一次目标
  Skill 的显式 invocation；多个 Skill、多个直接消息或非文本输入全部拒绝；
- Generation 中恰好存在该 Skill 的 immutable Git artifact，并通过现有 Git materialization 完整性门；
- 用户文本最多 8 KiB，纠正最多 4 KiB。

草稿只包含直接用户文本、纠正、Session/message/feedback/Generation 引用、exact Skill Git
artifact 和目标 assistant 之前的 durable prefix hash。它不包含 assistant response、Tool output、
Skill body、cwd 或完整 Transcript。

草稿 id 由规范化内容计算。目录必须是权限不宽于 `0700` 的真实目录，文件必须是权限不宽于
`0600` 的普通文件。实现先写同目录私有临时文件并 `fsync`，再用不会覆盖已有目标的 hard link
安装；同内容重试返回已有草稿，已有 id 内容不一致时拒绝。

Case Draft 不调用模型、不生成 Candidate、不执行 Trial、不晋升或回滚。它只是后续 Case 编译器的
输入；没有 replay result 和 evaluator score 就不能称为可重放 Case。

## 结果

- 正常反馈和原 Session 路径仍只有 P1.3 的异步引用投影，模型表面和额外 token 保持为 0；
- 原文复制是显式、逐条、可审计的本地动作，不会因后台观察静默发生；
- exact Generation、单 Skill invocation 和当前 feedback version 把误归因范围压到最窄；
- 私有草稿可删除，不成为第二套 Session/Memory 权威；
- 下一步仍需为具体失败类型提供 deterministic reproduction/evaluator，才能把 Draft 编译成 sealed
  Case 并进入现有 Trial。多个真实编译器出现前不抽象公共 Adapter。

