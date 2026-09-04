# ADR-0104：原生会话优先，Goal 仅作可选长任务关联

## 状态

Accepted（2026-09-05）。它取代把 Goal 写成所有交互前提的旧设计；旧证据仍按其原始 epoch 保留。

## 背景

DSH 的 Goal 是用于持续工作和恢复的原生对象，Hermes 的主要体验则是普通对话、渠道消息和异步 review。此前
EvoForge 文档把“用户只能提交 Goal”写成产品入口，并把无 Goal 的消息排除在自我发现之外。这会强迫用户先填
任务表单，误把 DSH 的长任务实体当成所有请求的通用协议，也会丢失用户纠正、命令、附件和渠道事件中的学习信号。

## 决策

1. 运行入口是原生 DSH Interaction：消息、问题、指令、附件、反馈、Tool/Session 事件、Schedule 触发和渠道事件
   都可以正常执行并产生可归因信号。
2. 用户可以在自然语言中表达目标、材料、约束、验收标准和希望使用的权限；这些文字不能扩大 DSH policy 或绕过
   Protected Action。
   这类文本在内部只形成短生命周期的 `GoalIntent`（请求语义投影），不写成 DSH Goal，也不要求用户填写固定
   字段；只有 DSH 原生 Goal service 明确创建后才产生 Goal id。
3. native Goal 只在用户需要长期续接、冷恢复或显式目标管理时创建。Goal id 是可选的关联字段，不是能力发现或
   Candidate 生成的硬前提。
4. Work episode 只是从 DSH Session/Workspace 日志派生的只读投影，不是新 Session、Goal、任务队列或状态权威。
5. Fast loop 从所有有权限的 Interaction 记录 signal；slow loop 可以要求足够多的独立 Interaction/结果样本，
   但不能把“跨 Goal”当成唯一的独立性定义。历史 Goal-linked evidence 继续可读，并在旧 epoch 中按原规则评测。
6. 现有 exact Skill attribution、holdout、retention、future-Session pin、canary 和 rollback 仍有效；只需将
   Goal 关联改为可选，并在缺失/歧义时 abstain，而不是把普通消息当作不存在。
7. Web 继续使用 DSH 原生 Session-scoped conversation.view；空 Session/onboarding 不显示该 slot 时，产品报告
   原因并引导打开原生 Session，不创建第二网页。若未来使用 settings/sidebar seam，必须另立 ADR 和真实浏览器门禁。

## 后果

- 普通聊天、纠正和渠道消息不再被迫转换为 Goal，体验与 DSH/Hermes 的常用路径一致。
- 进化证据覆盖更完整，但归因要求更严格：没有 durable Session/Interaction identity 的事件只能 abstain。
- 旧 ADR 中的 Goal 数量阈值只适用于冻结的历史 evidence；新机会应以“独立、可重放的 Interaction 样本”定义样本资格。
- 需求、架构、README 和 Agent 提示不得再写“入口只接受 Goal”或“无 Goal 一律不学习”。
- `GoalIntent` 不是新的公共实体、存储或 API；它只帮助同一 Interaction 解释材料、约束和验收语义，缺失时仍按
  普通消息处理。

## 验收

- 普通消息、纠正、附件和渠道事件在无 Goal 的 Session 中仍能产生安全的 signal；
- 长任务可显式创建并恢复 native Goal，且不会创建第二对象；
- 同一 Session 当前 Generation 不漂移，Candidate 只影响未来 Session；
- 旧 epoch benchmark 结果不被重写，新 benchmark 报告记录 Interaction 类型和 Goal 是否存在；
发布门必须拒绝 Goal-only 入口文案；当前 checker 只覆盖复制用 prompt，README、UI 和操作文档仍由本 ADR 约束。
