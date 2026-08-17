# EvoForge 调研资料索引

本目录记录 EvoForge 设计所依据的源码审计与用户需求证据。项目结论以固定 revision 为准，避免把持续变化的上游仓库误写成永久事实。

## 建议阅读顺序

1. [DeepSeek Harness 架构与设计审计](deepseek-harness.zh.md)：先理解 DSH 的插件内核、Session 事实源、能力接缝、作用域、权限和 KV Cache 优势。
2. [DeepSeek Harness 原生插件全目录（171）](deepseek-harness-native-plugins.zh.md)：按领域查看全部可加载原生插件、作用、装载位置、模型可见面和缓存影响。
3. [Claude Code Rev 源码审计](claude-code-rev.zh.md)：学习其 Tool、Hook、Skill、Agent、Session、权限与压缩设计，同时注意它只是第三方逆向恢复仓库。
4. [Hermes Agent 深度调研](hermes-agent.zh.md)：理解常驻个人 Agent、Memory、Skill、Gateway、Cron 和现有自我改进闭环。
5. [三项目横向比较](cross-project-comparison.zh.md)：查看三者的能力映射、取舍以及 EvoForge 应组合什么、不应照搬什么。
6. [用户核心痛点证据](user-pain-evidence.md)：用真实需求约束路线图，防止把平台工程当成用户价值。
7. [公开 Agent 自进化项目证据审计](public-self-evolving-agents.zh.md)：横向审计 Hermes Self-Evolution、GEPA、DGM、Voyager、ADAS、AFlow、Agent0 等项目，并校准当前方案的独特价值与缺陷。
8. [AS-1 首个通用助理工作流选择](assistant-workflow-selection.zh.md)：解释为何先做一个 Telegram 私聊，而不是预建通用 Gateway，并冻结其权限、投递和缓存边界。
9. [下一用户结果研究（2026-08）](next-user-outcome-2026-08.zh.md)：在现有能力和一手用户痛点之间比较下一项最小交付，解释为何先补后台进化注意力。
10. [P3.2 Draft PR 返修决策](p3-2-delivery-review-loop-decision.zh.md)：解释为何闭合现有交付断点，而不建设 Review 平台、Mission 或第二状态机。
11. [可证明自进化设计](../architecture/evolution-design.zh.md)：查看 Generation 固定、Learning Signal、Candidate、Trial、晋升、回滚与缓存约束。
12. [P0A Shadow 契约](../architecture/p0a-shadow-contract.zh.md)：查看首个可执行验证的 CLI、报告、case 隔离、evaluator 和红测试接缝。

## 审计基线

| 项目 | Revision | 证据定位 |
|---|---|---|
| DeepSeek Harness | `47f943859bef60e4160492346772ded9b24f765a` | 一手源码、测试、配置、包 README |
| Claude Code Rev | `64915d730218363acba49e5454dc01c31e3986b1` | 第三方 source-map 恢复源码；只作行为参考 |
| Hermes Agent | `29d0cc2602e01943ab300c0382fc9d97efb376da` | 一手源码、测试、仓库文档 |

## 文档边界

- 本目录回答“现有项目是什么、为何这样设计、优缺点是什么”。
- [需求基线](../requirements.zh.md)记录用户已经确认的目标、授权边界和交付顺序。
- `architecture/` 与 `adr/` 记录 EvoForge 的候选设计和关键决策。
- 研究基线已经完成；代码能力是否完成以[当前实现状态](../status.zh.md)为准，架构目标不自动等于已实现能力。
