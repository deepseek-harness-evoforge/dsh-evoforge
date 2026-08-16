# ADR-0017：显式消息反馈只派生可撤回引用

## 状态

Accepted，2026-08-16。

## 背景

用户在真实会话里点“负反馈”并写明原因，是比模型自我反思更直接的改进线索。DSH 已由
`@deepseek-ai/dsh-message-feedback` 持久化逐消息 rating、note、opaque version 和 Session
生命周期；EvoForge 不应再造 `/learn`、第二套反馈 UI、Transcript Memory 或通用 Signal Bus。

但原始反馈也不能直接成为 Skill 修改或回滚事实：备注可能包含私有信息，单条意见可能只适用于
当前任务，并且“用户不满意”不等于能归因到某个 Capability Generation。

## 决策

`dsh-evolve` 旁路观察 DSH 已 durable 的 `message_feedback/sessions` 变更，只把
`negative + non-blank note` 投影为 `Explicit Feedback Signal`。派生记录只包含：

- Session id、消息 id；
- DSH 生成的 opaque feedback version 与 source updated time；
- 观察时间和该 Session 已固定的 Generation id（若有）；完整 Session lifecycle 只在观察当下
  用于精确查询 Generation，不持久化 createdAt、cwd 或它们的 hash。

原 note、note hash、cwd、Prompt、Transcript 和消息正文都不复制。一个 Session 使用一条原子
replacement row；用户删除反馈、改成正反馈或移除 note 时，派生引用随下一次 source change
消失。最多保留最近 1000 个 Session、每个 Session 最近 100 条当前引用。动态总数只显示在
host-only `/evolve status`，不进入 Prompt、Tool Schema、Skill catalog 或模型请求。

该 Signal 只证明“这里有一条当前明确负反馈”。P1.3 不生成 Candidate、不花 proposal token、
不晋升、不回滚。未来若由它发起候选，执行器必须从 DSH 权威服务读取同一 Session/message 的
当前值并核对 opaque version，再经过已有 sealed Trial 与 release policy；失配或已撤回就停止。

监听器同步返回，派生 Storage 写入异步串行执行，任何失败只记 warning，不阻塞原反馈操作或
原 Session。进程若恰在 source durable 与 derived durable 之间退出，可能少一条派生样本；原始
DSH feedback 仍完整保留。当前接受这个极窄窗口，不为观察性数据复制 Session 日志、接管
message-feedback Domain 或增加第二套事务/event store。

## 结果

- 用户复用 DSH 已有反馈 UI，EvoForge 无新增学习命令和模型可见面；
- 反馈编辑和撤回有明确语义，派生状态可删除、可限量、重启后恢复已落盘引用；
- 短备注不会通过 hash 留下可字典猜测的副本；
- P1.3 解决“明确纠正如何安全进入证据链”，尚未解决“如何把新失败变成可重放 Case”；
- 多个真实消费者出现以前，不发布通用 `LearningSignal` runtime interface。
