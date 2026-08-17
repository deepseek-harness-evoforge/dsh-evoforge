# ADR-0040：自动模糊审查采用有界等待窗口

- 状态：accepted
- 日期：2026-08-17

P1.18 保证同一 Skill 同时只有一条未决自动路径，但一个无人处理的模糊 Candidate 会因此永久冻结该
Skill。备选方案是永久等待、增加通知/定时清理系统，或允许新 Signal 绕过旧 Candidate；它们分别导致
自治停滞、额外常驻复杂度或重复付费与 review 噪声。

P1.19 因此只对 Automatic Feedback Shadow 产生的 `recommendation: review` 设置默认 168 小时、可配置
`1..2160` 小时的窗口。清理只在下一条 Signal 的既有预算前 preflight 发生，并复用 durable rejection；
证据保留，人工/明确 `promote` Candidate 不受影响，写入失败继续 fail closed。

该选择用“安全放弃一个长期无人确认的模糊候选”换取自动学习不会永久停摆。它不引入 timer、通知、
新状态机或模型面；若真实 review 数据显示默认窗口不合适，应调整配置默认值，而不是扩张为通用队列。
