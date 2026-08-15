# EvoForge 开发路线图

> 状态：设计确认前的执行基线；每阶段只有满足退出条件才进入下一阶段

## 当前状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| R0 上游与市场研究 | 完成 | DSH、171 插件、Claude Code Rev、Hermes、公开自进化项目报告 |
| R1 产品边界 | 完成 | Requirements、CONTEXT、产品架构、ADR、插件目录和接口规范 |
| R2 开源仓库就绪 | 部分完成 | 本地 Git 基线已提交；远端仓名、GitHub 认证和许可证未冻结 |
| P0A Shadow evaluator | 等待设计确认 | 尚无实现或效果证据 |

## P0A — 先证明会判断

交付：离线 `evolve shadow <skill>`，只读 active Skill。

- 一个真实软件开发 Skill；
- 3–5 个 deterministic reproduction cases；
- 相互隔离的 search、selection、final-test；
- 一个已知坏 Candidate 和至少一个真实纠正；
- 最小 patch proposer；只有净收益不足时才试私有 GEPA adapter；
- 报告 claim、diff、逐 case 结果、成本和限制，不做激活。

退出条件：稳定拒绝坏 Candidate，并至少有一个改善通过未参与搜索的 final-test。否则停止，不建设在线发布底座。

## P0B — Local Continuity 与 Release Safety

进入条件：P0A 通过。

- immutable Generation manifest；
- Session sidecar pin，resume/fork/child 保持 Generation；
- future-session-only active pointer；
- crash injection、幂等恢复和精确 rollback；
- 完整 composition fingerprint；
- 不生成外部不可逆效果。

退出条件：所有注入崩溃点无半激活、无重复效果；活动 Session 不漂移；卸载后原生 DSH 可恢复。

## P0C — 可充分交互的人工闭环

- `/evolve status | review | promote | rollback | pause | resume`；
- host view 显示 claim、diff、case、成本、缓存、权限和 rollback target；
- review inbox 聚合、静默、可过期；原会话不等待；
- P0C 所有激活仍由人工决定。

退出条件：不了解内部实现的用户可以在一次查看中解释“改了什么、凭什么更好、有什么风险、怎么撤销”。

## P1 — 极窄自动晋升

- 仅 project-scoped、owned、纯指令且权限效果不变的 Candidate；
- deterministic clear win、独立 final-test、rollback rehearsal；
- future-session canary；可重放反事实证明回归时自动 rollback；
- 代码、工具、权限和外部动作继续只到 Draft PR/review。

退出条件：真实 Shadow/Canary 数据证明 false promotion、false rollback、review rate 和每次减少返工的成本在预声明预算内。

## P2 — Software Delivery 产品化

- 原生 Goal 到 worktree、仓库规范、测试、diff、commit、Draft PR；
- Completion result 只保留 passed、failed、unknown 和 artifact reference；
- 作为独立插件可在关闭 Evolve 时使用；
- 为 Evolve 提供真实 outcome adapter，不反向依赖 Evolve。

## P3 — 一个通用助理场景

从消息、日程、内容或个人助理中只选一个已有高频需求的工作流。要求外部效果边界、审批、幂等与 outcome evaluator 先于实现。成功后再决定下一个 Adapter。

## Future — High Availability

只有单机运行数据证明 Local Continuity 有价值，并且用户提出明确 SLO 与多个故障域后，才设计多实例选主、故障转移和共享状态。该阶段不能以“常驻进程”冒充完成。

## 不随阶段增长的硬约束

- DSH 是唯一 Runtime；Goal 是唯一长期目标概念。
- KV Cache 是所有插件第一优先级；UI 和进化状态留在 host plane。
- 新能力通过 upstream-fixed test，不承接 DSH Core Defect。
- 每次只增加能独立解释的用户结果；共享 seam 需要两个真实 Adapter。
- Protected Action 不因自治程度提高而自动获得授权。

## 外部准备项

1. 在 `deepseek-harness-evoforge` 组织下确定首个远端仓名；
2. 选择开源许可证；
3. 登录 GitHub CLI 或提供其他安全推送方式；
4. 冻结发布包 scope 与命名；
5. 项目所有者确认 P0A 设计后才进入代码。
