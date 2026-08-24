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
8. [DSH 插件组、自进化与个人 Agent 生态增量调研（2026-08-18）](ecosystem-frontier-2026-08-18.zh.md)：固定 Hermes、Hermes Self-Evolution、OpenClaw、HanaAgent 与前沿实现的历史生态事实；其中运行时外部 Skill 获取建议已被 2026-08-19 目标纠正否决，当前只保留内部经验自我发现、三平面和双速闭环约束。
9. [DSH 当前附件契约审计（2026-08-24）](dsh-current-attachment-contract-2026-08-24.zh.md)：区分 rc.5 已验证支持基线与 rc.2 最新设计审计，核对图片、普通文件、音频、视频和 DeepSeek Files API 的真实边界。
10. [AS-1 首个通用助理工作流选择](assistant-workflow-selection.zh.md)：解释为何先做一个 Telegram 私聊，而不是预建通用 Gateway，并冻结其权限、投递和缓存边界。
11. [P3.2 Draft PR 返修决策](p3-2-delivery-review-loop-decision.zh.md)：解释为何闭合现有交付断点，而不建设 Review 平台、Mission 或第二状态机。
12. [可证明自进化设计](../architecture/evolution-design.zh.md)：查看 Generation 固定、Learning Signal、Candidate、Trial、晋升、回滚与缓存约束。
13. [P0A Shadow 契约](../architecture/p0a-shadow-contract.zh.md)：查看首个可执行验证的 CLI、报告、case 隔离、evaluator 和红测试接缝。

## 审计基线

| 项目 | Revision | 证据定位 |
|---|---|---|
| DeepSeek Harness | `47f943859bef60e4160492346772ded9b24f765a` | 一手源码、测试、配置、包 README |
| DeepSeek Harness（2026-08-24 最新附件契约审计） | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | 官方 tag `dsh-v0.1.1-rc.2` 的一手源码、文档与 Git 历史；只作设计审计，不扩大支持声明 |
| Claude Code Rev | `64915d730218363acba49e5454dc01c31e3986b1` | 第三方 source-map 恢复源码；只作行为参考 |
| Hermes Agent | `29d0cc2602e01943ab300c0382fc9d97efb376da` | 一手源码、测试、仓库文档 |
| Hermes Agent（2026-08-18 增量审计） | `7a81dd9efdaa1d27a98815df6aecc26d849ca084` | 一手源码与官方文档；不追溯改写旧 paired epoch |
| Hermes Self-Evolution | `0a929e3aa20e15cf04dc7c28492a7d41a5139125` | 一手源码、PLAN 与仓库文档 |
| OpenClaw | `1c3e512096bc57b34f9379b1992912c3d18729c7` | 官方文档与一手源码 |
| HanaAgent / openhanako | `c6d0405294be67cb134c2758f6472748ee73e2be` | 一手源码与插件规范 |

## 文档边界

- 本目录回答“现有项目是什么、为何这样设计、优缺点是什么”。
- [需求基线](../requirements.zh.md)记录用户已经确认的目标、授权边界和交付顺序。
- `architecture/` 与 `adr/` 记录 EvoForge 的候选设计和关键决策。
- 基础研究与 2026-08-18 增量审计已经完成；代码能力是否完成以[当前实现状态](../status.zh.md)为准，架构目标不自动等于已实现能力。新 benchmark 必须在运行前重新固定 revision。
