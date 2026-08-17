# ADR-0039：每个 Skill 只推进一条未决自动进化路径

- 状态：accepted
- 日期：2026-08-17

P1.15 的日预算限制自动尝试总量，但当纠错集中出现时，P1.14/P1.16 仍可能在前一个 Draft、Shadow 或
Candidate 尚未处理前消耗第二次额度，并制造重复 review。P1.18 因此在预算预留之前读取既有
Evaluator Draft、Shadow journal 与 Review Inbox；同一 Skill 存在未决事实时，新自动信号保留在原
Signal Store，后续 resident scan 再检查。事实不可读时 fail closed。

不增加队列、数据库、lease、timer、Tool、Prompt 或配置；同一 Signal 的 evaluator/Shadow crash
reentry 仍可进入既有内容寻址路径并返回 durable 状态，不会重复付费。terminal reject/incomplete、qualified 或已经
激活/人工 disposition 后可以处理下一条。逐次人工 author/Shadow 不受此策略限制，原 Session 不等待。
该门只保证受支持的单机单 resident 自动扫描拓扑，不宣称跨多个 DSH 进程的分布式互斥。
