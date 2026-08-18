# DSH 插件组、自进化与个人 Agent 生态增量调研

> 调研日期：2026-08-18  
> 用途：约束 EvoForge 产品需求、架构与后续实现；不是既有实现完成声明。  
> 一手基线：DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`（本仓当前兼容基线）；Hermes Agent `7a81dd9efdaa1d27a98815df6aecc26d849ca084`；Hermes Self-Evolution `0a929e3aa20e15cf04dc7c28492a7d41a5139125`；OpenClaw `1c3e512096bc57b34f9379b1992912c3d18729c7`；HanaAgent 仓库 `openhanako` `c6d0405294be67cb134c2758f6472748ee73e2be`。开发前仍须重新固定 DSH 当前官方 revision，不能把本文记忆当 API。

## 结论

目标应是“一组可直接安装到 deepseek-harness 的 DSH 插件”，不能写成 Codex 插件，也不能把 Hermes 的实现原样搬进 DSH。用户只提交自然语言 Goal、材料、约束与验收条件；系统内部自主完成能力检索、路径选择、执行、缺口发现、Skill 发现/生成/组合、验证、晋升和复用，开头不得要求用户选择任务类别、工作流、Agent 或 Skill。

真正有竞争力的形态是三平面、双速闭环：稳定执行面负责当前任务；隔离进化面生成候选；候选不可修改的治理/评测面掌握 holdout、gold、权限和晋升。在线快环捕获可归因的纠正、成功步骤、返工和成本信号，只形成小步候选；离线慢环聚类能力缺口，搜索本地与市场 Skill、官方资料、论文和开源实现，生成完整 Skill 包候选，经隔离多任务 rollout、baseline/candidate 对照、未见样本、回归、安全、成本与时延门禁后，才对未来 Session 晋升。没有证据时允许 abstain；一次成功、模型自评、使用次数或普通 retry 都不等于进化。

## 1. DSH 官方边界

- DSH 的可安装扩展单位是 Cordis 插件/Bundle。外部包由 `dsh plugin --profile <name> add <package-or-git-spec>` 安装；只有 `package.json` 声明 `"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}` 的依赖才自动进入 profile bundle 层。普通依赖不会自动激活。[官方 CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/apps/cli/reference/README.md#L41)
- 插件导出 `apply`，用 `inject` 声明硬依赖；依赖消失时 Consumer 会卸载，恢复时重载。注册、计时器、watcher、连接和子进程必须由 Cordis effect/disposer 管理，不能靠启动顺序或进程退出兜底。[Service 与 inject](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/03-services.md#L44) · [生命周期与 effects](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/02-lifecycle-and-effects.md#L5)
- Web 扩展必须使用 DSH Client module 接缝：宿主扫描包的 `dsh.client` 声明并向浏览器启动 manifest 投影 bundle；刷新从当前组合重新启动。它是 Web 控制面，不属于 Agent Loop。[Client modules](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/client-modules.zh.md#L5)
- 因此交付不能自创 manifest、插件加载器、Session、Goal、审批或 Web 状态源；应组合 DSH 原生 Goal、Session、Skills、Storage、Jobs/Schedule、Approval、Sandbox、Typert Remote 和 Client plugin，并完成安装、`--dump-config`、boot、reload/dispose、卸载、Session 恢复与真实浏览器验证。

## 2. Hermes：功能基线，不是架构模板

Hermes 的产品基线包含渐进加载 Skills、持久记忆与 Session 搜索、Cron、子 Agent、代码执行、MCP、浏览器/文件/终端、插件和多消息平台；插件可贡献 tools、hooks、commands、skills、platform、memory、context 和 model provider。[Hermes 功能总览](https://hermes-agent.nousresearch.com/docs/user-guide/features/overview/) · [插件文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)

Hermes 主仓支持 Agent 创建/更新 Skill，但“解题后保存方法”不能证明未来能力提升。[官方 Skill 指南](https://github.com/NousResearch/hermes-agent/blob/7a81dd9efdaa1d27a98815df6aecc26d849ca084/website/docs/guides/work-with-skills.md) 独立 Self-Evolution 项目使用 DSPy/GEPA 做 Skill 优化；其 README 明确当前已实现重点仍是 `SKILL.md`，tool descriptions、system prompt、code 和 continuous loop 仍在规划范围。[Self-Evolution 仓库](https://github.com/NousResearch/hermes-agent-self-evolution/tree/0a929e3aa20e15cf04dc7c28492a7d41a5139125) · [PLAN](https://github.com/NousResearch/hermes-agent-self-evolution/blob/0a929e3aa20e15cf04dc7c28492a7d41a5139125/PLAN.md)

所以“上位替代”应按可感知结果验收：自主 Goal 执行、工具/MCP、Skill/记忆、Cron、子 Agent、消息平台、恢复和可观测性至少达到 Hermes；差异化落在 DSH 原生插件化、无开场选路、能力缺口发现、整包候选、严格实证晋升、Session 固定版本、可解释回滚、飞书与 DSH Web 控制面。

## 3. OpenClaw：当前最强的在线学习治理参照

OpenClaw 的 Self-learning 能从明确纠正和高投入任务产生 Skill proposal；后台 reviewer 隔离运行、不能调用通用工具或直接改 live Skill，并可 abstain。Apply 具有安全扫描、workspace 写边界、目标 hash 绑定、quarantine、rollback metadata 和一次失败即停；启用后可选 `off/propose/auto`。[Self-learning](https://docs.openclaw.ai/tools/self-learning) Skill Workshop 还公开 `skill_proposal_evaluate` hook：第三方 evaluator 可返回指标和决策，候选以文件/tree hash 固定，目标漂移后必须重评。[Plugin hooks](https://docs.openclaw.ai/plugins/hooks#skill-lifecycle-and-evaluation)

OpenClaw Web 已把插件、Skill 和 Workshop proposal review 做成控制面；插件也可贡献受 scope 约束的侧栏 tab。[Control UI](https://docs.openclaw.ai/web/control-ui) · [Plugin SDK overview](https://docs.openclaw.ai/plugins/sdk-overview) 飞书插件已提供 WebSocket 默认接入、DM/群聊、流式卡片以及文档、知识库、云盘和多维表格工具。[Feishu 官方文档](https://docs.openclaw.ai/channels/feishu)

应借鉴 receipt/hash、隔离 reviewer、扫描、quarantine、rollback、可 abstain 和 Web 审核体验；但不能停在“scanner 通过后自动写”。DSH 方案必须增加真实 rollout、严格 holdout、baseline/candidate 因果对照和长期回归，否则仍无法证明变好。

## 4. HanaAgent：零路由产品体验与插件 UI/飞书参照

HanaAgent（官方仓库仍名 `openhanako`）面向普通用户，支持主动安装/编写 Skill、多 Agent、记忆、Cron、沙盒、桌面/移动/LAN UI，以及 Telegram、飞书、QQ、微信 Bridge。[官方 README](https://github.com/liliMozi/openhanako/tree/c6d0405294be67cb134c2758f6472748ee73e2be) 其插件可贡献 tools、skills、commands、Agent templates、HTTP routes、providers、pages、widgets、config 和 background tasks，并区分 restricted/full-access；插件私有数据有独立目录。[插件规范](https://github.com/liliMozi/openhanako/blob/c6d0405294be67cb134c2758f6472748ee73e2be/PLUGINS.md)

应学习它的无术语入口、拖拽安装、图形化、桥接与两级权限；同时为每个 Skill 明确稳定 identity、来源、scope、版本、优先级、冲突和去重，避免“目录里存在多个同名 Skill，却无法解释实际使用哪一个”。

## 5. 外部 Skill 市场与开放发现协议的增量核验

OpenClaw 当前已经把 ClawHub 明确为公开 Skill/插件 registry：原生命令支持 search/install/update，安装会
记录来源，用户可在安装前查看版本、changelog 与 scan 状态；`verify` 还能读取 registry 的 trust envelope。
这说明“市场发现、来源锁定、安全分析、安装”应是四个可区分阶段，不能把搜索命中直接等价为可执行能力。
[ClawHub quickstart](https://docs.openclaw.ai/clawhub/quickstart) ·
[OpenClaw Skills](https://docs.openclaw.ai/skills)

ClawHub 的 Skill 仍是含 `SKILL.md` 与可选支持文件的目录，并通过 origin/lock metadata 追踪来源；其官方
格式要求声明 runtime/env/bin 等需求，完整 bundle 进入安全扫描，当前公开 Skill 统一为 MIT-0。这是一个
具体市场的产品契约，不是 DSH 的通用安装接口，也不能用 scan 状态证明任务效果。
[ClawHub Skill format](https://docs.openclaw.ai/clawhub/skill-format) ·
[ClawHub CLI](https://docs.openclaw.ai/clawhub/cli)

Cloudflare 发起的 Agent Skills Discovery via Well-Known URIs 当前状态是 **draft v0.2.0**，规定
`/.well-known/agent-skills/index.json`、固定 `$schema`、`skill-md | archive`、artifact URL 与原始字节
`sha256:<hex>`。客户端必须按 digest 校验下载内容，并应对来源 allowlist、prompt injection、script 默认不
执行及 archive traversal/link/decompression bomb 做防护。它提供的是可移植 discovery index，不提供
质量、许可证适用性或 release eligibility。
[Agent Skills Discovery draft v0.2](https://github.com/cloudflare/agent-skills-discovery-rfc/blob/main/README.md) ·
[Agent Skills specification](https://agentskills.io/specification)

**设计推断：** EvoForge 首个网络纵切应优先采用这个开放、digest-pinned 的 index，而不是绑定 ClawHub
私有 API 或 popularity 排名；但只能把它当供应链输入。当前实现固定 v0.2、显式配置、HTTPS、同源、
bounded UTF-8 和 SHA-256，只接收单文件 `skill-md` 并进入 durable quarantine。Archive 在安全解包门完整
之前拒绝；ClawHub adapter、任意 Web/GitHub 搜索和候选生成仍分开排期。

## 6. 前沿实现带来的新增硬要求

- **EvoSkill**：从失败轨迹发现/修改 Skill，用 Pareto frontier 和 held-out validation 选择，并报告跨任务迁移；说明“发现能力”与“保留能力”必须分开。[论文](https://arxiv.org/abs/2603.02766) · [代码](https://github.com/sentient-agi/EvoSkill)
- **SkillHone**：进化单位是整个 Skill folder（`SKILL.md + scripts + references`），eval 与 Skill 通过代码路径/文件权限隔离，每个决策有 Git 审计；DSH 应做整包原子版本，而非只改 prompt。[官方仓库](https://github.com/Tencent/SkillHone) · [论文](https://arxiv.org/abs/2606.08671)
- **OpenSkill**：当没有现成 Skill、成功轨迹或 verifier 时，从官方文档、仓库和 Web 获取知识与 verification anchors，构造虚拟任务，再把真实目标保留给 final evaluation；这给“自我发现 Skill”一个可实现定义。[论文](https://arxiv.org/abs/2606.06741) · [代码](https://github.com/OpenLAIR/OpenSkill)
- **Adaptive Auto-Harness**：开放任务流下，一个反复密集改写的单体 harness 会变脆；应保留专门化能力树并在 solve-time 自动路由，缺失信号时允许人类 steering。[论文](https://arxiv.org/abs/2606.01770) · [代码](https://github.com/A-EVO-Lab/AdaptiveHarness)
- **PAST-Bench**：用按顺序的新 Session、retention on/off 匹配对照，同时测后续收益和 save→retrieve→update 路径证据；说明验收不能只看最终正确率。[论文](https://arxiv.org/abs/2608.04003) · [代码](https://github.com/Gen-Verse/PAST-Bench)
- **EvoAgentBench**：自动方法没有在所有设置持续获得正收益；应测跨任务/模型 transfer、error avoidance、Skill routing/uptake，而非发布一次分数。[论文](https://arxiv.org/abs/2607.05202) · [代码](https://github.com/EverMind-AI/EvoAgentBench)
- **DGM**：候选 archive 和谱系比贪心保留单一冠军更能避免局部最优；但模型生成代码必须被强隔离，不能获得 evaluator、gold、权限或发布面的写权。[论文](https://arxiv.org/abs/2505.22954) · [代码](https://github.com/jennyzzt/dgm)

由此得到不可缩减的评测维度：任务成功率、首次成功率、人工选路/干预次数、失败恢复、Skill 发现召回与错误调用、跨任务复用/迁移、负迁移、保留与遗忘、安全回归、成本、时延、cache-read、回滚正确性；并记录每个 signal→gap→candidate→trial→decision→generation 的完整证据链。

## 7. 插件组与交付约束

最小合理拆分是：`evolution-core`（闭环、版本与治理）、`skill-discovery`（本地/市场/官方资料与开源证据）、`eval-lab`（隔离评测）、`integrations-feishu`（双向消息、文件、卡片、通知、身份/会话映射、幂等与审批）、`evolution-web`（DSH Web 页面/API）。它们共享一个版本化事件/存储契约，但各自可安装、禁用、卸载；其他消息、日历、内容等 Adapter 按证据增量加入，不做巨型 Gateway。

DSH Web 至少展示 capability map、gap queue、Skill 来源/scope/version/utility、候选谱系和 diff、基线/候选/holdout 分数、失败归因、证据、成本/时延/cache、安全扫描、quarantine/promotion/rollback、当前 Generation/tag，以及飞书连接健康与投递状态。UI 只读投影权威 host 状态，关键动作走 DSH Approval，并做真实浏览器端到端验证。

仓库工作流按用户约束：只在 `main` 小步 commit/push 实时同步，不创建功能分支或发布分支；核心功能整体验证通过后才打 annotated semantic tag，之后每个可验证迭代继续以 tag 标记。运行时 Candidate 不等于代码分支，必须进入隔离、内容寻址的候选存储；只有通过门禁的受测资产才能晋升，不能污染 `main` 或活动 Session。
