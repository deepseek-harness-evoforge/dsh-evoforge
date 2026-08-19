# ADR-0015：交付 Outcome 是派生信号，不是回滚事实

> 输入权威与崩溃恢复已由 [ADR-0053](0053-delivery-outcomes-project-from-durable-session-log.md) 修正；“派生信号不等于回滚事实”的结论继续有效。

## 状态

Accepted，2026-08-16。

## 决策

`dsh-evolve` 从 DSH 原生 Session 日志中只读投影 `complete_delivery` 的最终规范值，在不改变 Tool
结果的旁路中记录 `passed | failed | unknown`、Goal/Session/call、Session 固定的
Generation、commit 和可选 Draft PR number。Prompt、消息、仓库路径、PR 正文、check argv/stdout/
stderr 不进入该记录；最多保留最近 1000 条并按 Session + call 幂等。动态聚合只出现在
host-only `/evolve status`，不进入模型 Prompt、Tool Schema 或 Skill catalog。

这些记录使用独立 `evoforge_delivery_outcomes` Storage Domain，不修改原有 Generation/Session-pin
事实源。ADR-0053 已删除“Session 已持久、投影却只能依赖 live event”的不可重建窗口：记录在先通过
原生 Session durability checkpoint 后，可从 persisted call/result pair 重建，但绝不重放工具或
外部效果。checkpoint、投影和写盘失败仍被隔离，不阻塞原会话；checkpoint 前 hard kill 的独立故障
注入仍是未完成门禁。

单次失败可能来自业务代码、测试基础设施或外部服务，不能归因于当前 Skill Generation。因此
P2D.1 只采集与展示，不自动回滚。后续自动回滚必须另有相同 sealed case 上“当前 Generation 失败、
父 Generation 通过”的可重放反事实证据；达不到该门就保持当前版本并进入异步复核。

P1.21 允许同一次有界聚合额外计算 active 与 exact parent/native DSH 的三态计数，并在 Commands/Web
并列显示。因为两组任务可能不是同分布，界面必须同时显示因果免责声明，不计算提升率、不生成 verdict，
也不触发 release 动作。该投影仍属于本 ADR 的“派生信号”，不需要新的持久 owner。
