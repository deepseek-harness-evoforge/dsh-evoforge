# ADR-0015：交付 Outcome 是派生信号，不是回滚事实

## 状态

Accepted，2026-08-16。

## 决策

`dsh-evolve` 通过 DSH 只读 `tools/result` 观察 `complete_delivery` 的最终规范值，在不等待写盘、
不改变 Tool 结果的旁路中记录 `passed | failed | unknown`、Goal/Session/call、Session 固定的
Generation、commit 和可选 Draft PR number。Prompt、消息、仓库路径、PR 正文、check argv/stdout/
stderr 不进入该记录；最多保留最近 1000 条并按 Session + call 幂等。动态聚合只出现在
host-only `/evolve status`，不进入模型 Prompt、Tool Schema 或 Skill catalog。

这些记录使用独立 `evoforge_delivery_outcomes` Storage Domain。它们是可丢失、可重建的派生证据，
不修改原有 Generation/Session-pin 事实源；进程恰在实时事件与 durable put 之间退出时，允许少一条
样本，而不重放工具或外部效果。监听和写盘失败被隔离，不阻塞原会话。

单次失败可能来自业务代码、测试基础设施或外部服务，不能归因于当前 Skill Generation。因此
P2D.1 只采集与展示，不自动回滚。后续自动回滚必须另有相同 sealed case 上“当前 Generation 失败、
父 Generation 通过”的可重放反事实证据；达不到该门就保持当前版本并进入异步复核。

P1.21 允许同一次有界聚合额外计算 active 与 exact parent/native DSH 的三态计数，并在 Commands/Web
并列显示。因为两组任务可能不是同分布，界面必须同时显示因果免责声明，不计算提升率、不生成 verdict，
也不触发 release 动作。该投影仍属于本 ADR 的“派生信号”，不需要新的持久 owner。
