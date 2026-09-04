# 调研与证据索引

本目录只回答两件事：上游源码/生态的可复核事实，以及这些事实如何约束 EvoForge 设计。它不是用户教程；用户从根目录 [README](../../README.md) 开始。历史报告保留原日期和 revision，不自动代表当前实现。

## 当前优先阅读

1. [DSH 最新版本审计（2026-09-05）](dsh-latest-audit-2026-09-05.zh.md)：本轮开发前的最新 revision、安装/构建结果和支持决策。
2. [产品目标与设计](../architecture/product-target-and-design.zh.md)：当前唯一产品边界。
3. [自我进化设计](../architecture/evolution-design.zh.md)：Interaction-first 双速闭环、Candidate 和治理门。
4. [Hermes 对照记分卡](../architecture/hermes-replacement-scorecard.zh.md)：哪些只是局部已验证，哪些还不能宣称替代。
5. [当前状态](../status.zh.md)：实现、验证和阻断的短快照。

## 参考项目与方法

| 对象 | 用途 | 不采用的部分 |
| --- | --- | --- |
| DSH | 唯一 Host、Session、Goal、Jobs、Approval、Storage 和 Web 权威 | 不另造 Runtime/Session/审批/网页 |
| Hermes / Self-Evolution | 常驻 Gateway、配对、跨会话经验和自我改进行为参照 | 不复制其 Runtime、状态源或未经证据的自我升级 |
| OpenClaw | reviewer、候选隔离、控制面和渠道边界参照 | 不引入外部市场获取或第二 Gateway |
| HanaAgent | Page/Widget 层级、权限和插件体验参照 | 不移植成 DSH 外部 UI |
| GEPA、EvoSkill、SkillHone、OpenSkill、DGM | 候选生成、反思、搜索/进化评测的研究参照 | 不把论文指标当产品证据；不让 proposer 兼任裁判 |

## 日期化资料

### Current（可作为当前设计/审计入口）
[DSH 最新版本审计](dsh-latest-audit-2026-09-05.zh.md)：唯一当前 DSH revision 入口。
Hermes paired 的冻结身份见 [参考生态最新 revision 审计](ecosystem-latest-audit-2026-09-05.zh.md)；前一日的结果页已移入 Historical。
[参考生态最新 revision 审计](ecosystem-latest-audit-2026-09-05.zh.md)：Hermes、Hermes Self-Evolution、OpenClaw、HanaAgent 的同日远端 HEAD。
[产品设计](../architecture/product-target-and-design.zh.md)、[进化设计](../architecture/evolution-design.zh.md)：当前实现基线。

### 冻结研究（只作设计依据，不能当 API/支持基线）
[Hermes Agent 深度调研](hermes-agent.zh.md)、[公开自进化审计](public-self-evolving-agents.zh.md)、
[可视化参考](plugin-visualization-reference-2026-08-25.zh.md)、[飞书/Gateway 配对调研](hermes-gateway-pairing-current-2026-08-24.zh.md)
均固定在各自标注的 revision。旧 DSH 目录清单、Claude Code 比较、昨日 revision 快照、阶段性 Goal 设计和重复
迁移报告已从工作树删除；需要追溯时使用 Git 历史。

## 维护规则

- 新 benchmark 或支持声明必须先记录 DSH/Hermes 的 exact revision、日期、命令和环境；旧 epoch 不覆盖。
- 研究结论不能直接变成运行时能力：EvoForge 不在运行时搜索、下载、导入或安装外部 Skill。
- 当前实现状态以 [status](../status.zh.md) 和日期化 evidence 为准；架构文档中的“必须”不是“已经完成”。
