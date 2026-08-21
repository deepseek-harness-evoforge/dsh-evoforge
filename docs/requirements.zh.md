# DeepSeek Harness EvoForge 项目需求基线

> 状态：已确认；目标是只安装并运行于 DSH 的原生 out-of-tree 插件套件。现有实现只作为可重审资产，不能限制重构；`dsh-gateway` 已替换旧 Router。ClawHub、市场、运行时 research Candidate、Git Skill source/ref、预选 Skill、静态 Case Pack/Feedback/Evaluator target、Feedback/Evaluator Draft、Shadow 内 proposer、自动 review expiry、旧 Retention/canary 和对应 Commands/Control/Web/attention 表面均已从活动源码删除。自然 Goal→Capability Gap→跨 Goal 内部经验→Skill Opportunity→隔离 whole-Skill Candidate 已形成纵切；Shadow 只消费 exact DSH-assembled Candidate 且零 proposer。现有 Skill 已完成完整 Bundle、protected Candidate、Candidate-blind exact Holdout/Retention、独立发布门及最终包浏览器生命周期；V4.46 又让 active release 的失败 Outcome 只在 exact lineage 下经原生 Jobs 重放 sealed baseline/Candidate/Retention pair，只有 baseline 恢复且 Candidate 失败才形成无 mutation 权的 rollback-eligible；V4.47 已用独立 Host gate、exact Canary id 和 expected-active compare 接入 Control/Remote/Web 人工 future-Session rollback；V4.48 已从最终 tarball 验证 existing-Skill approve/promote/Canary/断连保留/精确 rollback/冷恢复/卸载。缺失 Skill 的 Retention/Promotion/Canary/Rollback 纵切同样无评测自授发布权，V4.49 已从最终 tarball 验证 promote/Canary/断连保留/精确 root rollback/冷恢复/卸载。两套独立真实 provider、exact 飞书消息、长期 outcome 与 Hermes paired 完成前不构成 v0.1 交付。
> V4.39 已消费 V4.37 exact Admission 与 V4.38 Candidate-blind Envelope，在原生 DSH Jobs 中执行完整 `skill-tree ↔ skill-tree` paired holdout，并从最终 tarball 完成真实 DSH Web reload/断连/恢复/卸载验证；自动化成功路径使用注入式确定性 Trial，因此两套独立真实 provider、Retention 与发布资格仍未证明。
> V4.40–V4.45 已完成生成前 Retention 身份链、exact Retention、独立发布门及最终包浏览器生命周期；V4.46–V4.48 已完成 existing-Skill failed-Outcome Canary、权威 Control/Remote/Web、独立 expected-active rollback gate 及其最终包浏览器故障恢复；V4.49 已完成 missing-Skill 同类最终包故障恢复。两套独立真实 provider 仍未证明。
> 更新日期：2026-08-21
> 用途：记录项目所有者从最初请求到当前确认的目标、范围、约束和交付顺序，供学习、设计评审和后续 Agent 持续执行。本文记录需求，不代替源码审计和市场证据。发生冲突时，下述“方向纠正”优先于旧里程碑文字。

## 0. 方向纠正：DSH 是唯一 Runtime 与安装入口

本节是不可协商的当前交付顺序，并取代把 EvoForge 描述成独立工具、独立 Runtime 或旁路应用的任何旧表述。

1. `dsh-evoforge` 是真正的 out-of-tree DeepSeek Harness 插件套件。用户通过 DSH 官方 `dsh plugin --profile <name> add/remove` 和 Bundle/profile patch 机制安装、启用、禁用与卸载。
2. DSH 是唯一 Agent Host、Runtime、Session、Goal、Approval、Storage、Jobs、Skill、Tool 与 Cordis 生命周期权威。EvoForge 不建立第二套应用、CLI、Web server、daemon、数据库、任务系统或 agent loop。
3. 每个发布包必须导出 DSH/Cordis 可加载的 `name`、`inject`、`Config`、`apply`（或目标 revision 的官方等价接缝），声明官方 `dsh.bundle.patch`，并由 `ctx.effect()`/Cordis fiber 持有资源。
4. DSH/Cordis 只能由 Host 提供，放在 `peerDependencies` 与 `devDependencies`；打包产物不得包含第二份 Runtime。
5. Web 只能是随 DSH Web profile 组合加载、读取 DSH Host 权威状态的 client adapter；不得成为第二控制面。用户核心能力不得依赖 EvoForge CLI；开发夹具不得发布为产品入口。
6. 在 roadmap 恢复前，必须用固定目标 DSH 源码完成 clean-profile 的 tarball 安装、官方 Bundle 启用、`--dump-config`、Host 启动、真实 Agent/Session/Goal 能力、原生持久化、卸载后原生启动/读回以及无残留资源的 assembled 硬门禁。
7. 不 fork、不 monkey patch DSH。若门禁暴露 DSH Core Defect，只保留最小复现并上游报告。
8. 用户入口是自然语言 Goal、材料、约束与验收条件。系统必须在内部完成能力识别、Skill 路由和执行路径选择；开头不得要求用户从任务类别、工作流、Agent 或 Skill 菜单中选路。

截至本次纠正，目标源码为 DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a`（包版本 `0.1.0-rc.5`）。开发依赖可为获得已发布类型而使用兼容的 rc.6 包，但这不扩大支持声明；支持证据只来自上述固定源码 assembled gate。

## 1. 项目愿景

以 GitHub 组织 [`deepseek-harness-evoforge`](https://github.com/deepseek-harness-evoforge) 作为所有 DSH 扩展设计与开发的公开归属。首个公开仓库命名为 `dsh-evoforge`，通过 out-of-tree 插件为 DSH 增加真正有用、通用、可插拔的新能力；相关插件可以共仓，具有独立生命周期或信任边界时可以拆为独立仓库。

DSH 继续作为 Agent Runtime，拥有 Session、Goal、工具、权限、存储、工作流、Skill、调度和模型执行。EvoForge 复用这些原生接缝，不 fork DSH，不建立平行 Runtime，不以插件形式修补 DSH 核心缺陷。

长期目标是形成一个能够长时间自主运行、遵循真实工作流程、从实际结果中持续进化，同时保持简洁、可解释、缓存稳定和随时可回滚的通用 Agent 扩展体系。

## 2. 已完成的项目研究基线

本节保留原始验收口径，防止后续设计脱离源码事实。对应报告统一收录在[研究索引](research/README.zh.md)。

### 2.1 DeepSeek Harness

深入阅读 DSH 源码、测试、文档、示例和组合配置，形成足以帮助读者建立完整心智模型的中文报告。报告至少回答：

1. DSH 的总体架构、启动和组合方式是什么；
2. “一切皆插件”在代码中如何实现；
3. Cordis 生命周期、Context、Service、inject、effect、scope 和插件卸载如何协作；
4. Agent Loop、Session、Goal、Tool、Skill、Approval、Sandbox、Storage、Jobs、Schedule、Workflow、Subagent、Compaction、Hooks 和客户端如何组合；
5. 哪些是核心脊柱、能力接缝、Provider、Consumer 和 Bundle；
6. 一次模型请求的上下文、工具和事件是如何产生并持久化的；
7. DSH 的 KV Cache 优势来自哪里，哪些插件行为会破坏它；
8. DSH 值得借鉴的设计、适用边界、当前不足和扩展机会是什么。

### 2.2 DSH 原生插件目录

列举当前仓库内所有原生插件，不凭 README 标题抽样。最终目录必须说明统计口径，并为每项记录：

- 包名、源码路径和所属类别；
- 是否为 Service Definition、Provider、Consumer、Bundle、客户端插件或开发工具；
- 提供或依赖的 Context Service；
- 用户可感知作用；
- 主要配置和默认行为；
- 是否改变模型可见提示词、工具 Schema 或顺序；
- 生命周期、权限和持久化影响；
- 推荐使用场景和已知限制。

原始要求中的“171 插件目录”保留为交付目标表述；最终数量以指定 DSH revision 的可验证源码为准，并明确解释“包、插件、组合、客户端插件”的统计差异，不凑数。

### 2.3 Claude Code Rev

分析本地 `claude-code-rev` 项目，说明其逆向结构、Agent Loop、上下文构建、工具调用、权限、任务/Goal、计划、压缩、子 Agent、Hook、会话恢复和软件开发工作流。

总结其：

- 设计理念和关键模块；
- 值得 DSH/EvoForge 借鉴的能力；
- 对长时自治、可恢复性、权限和缓存的处理；
- 架构长处、局限、耦合和不适合复制的部分。

### 2.4 Hermes Agent

分析本地 `hermes-agent` 项目，既覆盖整体 Agent、Gateway、消息渠道、Cron、Memory、Skill、插件和会话体系，也重点审计其 self-improvement loop：

- 前台 Skill 创建与修改；
- 后台 memory/skill review；
- Curator、使用统计、归档、合并、备份和回滚；
- `/learn`、学习图和相关控制界面；
- 触发条件、模型成本、权限边界和故障恢复；
- 它如何判断“学到了”以及为何不等于“变得更好”。

总结 Hermes 值得继承的设计和必须超越的问题。目标不是逐功能复制 Hermes，而是让 `DSH + EvoForge` 在选定真实工作流中以可靠性、交互控制、缓存效率和持续进化证据成为更好的上位选择。

### 2.5 跨项目比较

使用同一组维度比较 DSH、Claude Code Rev 和 Hermes，至少包括：

- 插件化和扩展边界；
- Agent/Goal/任务模型；
- 上下文与 KV Cache；
- 工具和权限；
- Session 持久化与崩溃恢复；
- 长时间自治；
- 软件开发交付；
- Memory 与 Skill；
- 持续进化；
- 可观测性、测试和回滚；
- 个人助理和外部消息能力；
- 安装、理解和维护成本。

比较必须区分源码事实、合理推断、用户需求证据和项目所有者的战略选择。

### 2.6 生态与前沿增量调研

在进入内部经验自我发现和下一代进化闭环实现前，必须以固定 revision 继续审计 Hermes Agent、Hermes
Self-Evolution、OpenClaw、HanaAgent，以及有公开论文或源码的 Skill 发现、Skill 进化和 Agent 评测实现。
调研不是照搬任一项目，而是形成可证伪的设计选择：哪些交互与治理值得吸收，哪些必须因 DSH 权威、
KV Cache、权限、隔离和可回滚要求而拒绝。每个 benchmark epoch 必须单独固定当时 revision；旧 paired
结果继续绑定旧 revision，不能被新审计 revision 静默改写。

## 3. 产品定位

### 3.1 核心用户结果

EvoForge 首先服务软件开发交付，同时允许个人助理、内容、消息、日程等通用自治能力按需插拔。

软件开发的默认闭环是：

```text
原生 DSH Goal
→ 隔离 worktree
→ 遵循仓库规范
→ 编辑与测试
→ 可审查 diff
→ commit
→ Draft PR
```

软件交付也是持续进化的第一个试验场，因为测试、静态检查、diff、审查、返工、成本和 Goal 结果能够提供较强的客观反馈。

### 3.2 旗舰能力：持续进化

持续进化是 EvoForge 最亮眼的新增功能。其目标不是频繁修改自己，而是让真实任务结果持续产生可验证、可解释、可回滚的能力提升。

最小闭环为：

```text
自然语言 Goal
→ Capability Map 内自主路由，或形成可证伪 Capability Gap
→ 在线快环记录可归因的 Learning Signal / 小步候选
→ 离线慢环归纳 Skill Opportunity 并生成完整 Skill 包候选
→ 独立治理面执行 active/candidate、holdout、回归和安全评测
→ promote / review / reject / abstain
→ 只对未来 Session 生效
→ 持续监测、保留与精确回滚
```

必须满足：

- 先检查当前 Workspace 中可用、适用且已验证的 Skill/Tool；有现成能力时自主调用，不把选路责任转交用户；
- 没有适用能力时记录可复核的 Capability Gap；“自我发现 Skill”只从 DSH 自身 Goal、失败、纠正、交付结果、复用与保留证据中发现应形成或改进的可复用能力，不以运行时外部搜索代替自我发现；
- Hermes、OpenClaw、HanaAgent、论文、市场与开源实现只用于设计期调研和固定 revision benchmark；运行时不得搜索、下载、获取、导入或安装外部 Skill；
- 内部发现和生成只产生带稳定 identity、Workspace、版本、内容哈希、权限与安全状态的非活动候选；不得静默安装、启用或执行未知代码；
- 进化单位可以是完整 Skill folder（`SKILL.md`、scripts、references 与清单），必须原子版本化，不能只优化一段 prompt 就宣称能力进化；
- 在线快环只捕获可归因信号、缺口和小步候选；离线慢环负责跨任务机会发现、候选生成、迁移、遗忘、负迁移和长期保留判断；
- evaluator、holdout、gold、hard gate 与发布资格由 Candidate 不可读写的独立 Evaluation Governance Plane 持有；隔离无法证明时 Trial 为 `incomplete`；
- 无法证明改善时允许 `abstain`；一次成功、模型自评、使用次数、重试成功或安全扫描通过均不能单独晋升；
- 原会话不等待后台学习或人工审批；
- 反思只能提出候选，不能证明改进；
- 调用次数、复用次数、模型信心和新鲜度不能单独决定晋升；
- 明显正向且在授权范围内的指令型改进可以自动晋升；
- 模糊、主观、样本不足或有取舍的改进进入独立人工审批区；
- 每一个能力版本都可定位、比较和回滚；版本回滚不能撤销已经发生的外部副作用；
- 可执行代码、脚本、工具、权限和外部效果的自动激活受到更严格保护；
- 当前会话固定使用不可变能力版本，晋升只影响后续会话；
- 不重复实现 Hermes Self-Evolution 或通用 Prompt Optimizer；独特价值集中在 DSH 原生集成、KV Cache、Session 固定版本、非阻塞晋升、崩溃恢复和反事实回滚。

“跨 Goal 复用”必须有精确、可持久恢复的最低事实口径：成功的原生 `skill` 调用先经过 Session durability
checkpoint，再绑定 active Goal、模型实际看到的 invocation content hash 与 Session-pinned Generation；只有同一
Workspace 中相同 Skill name/content hash/Generation 覆盖至少两个不同 Goal id 才成立。同 Goal retry、同名内容
漂移、不同 Generation、失败调用或无 Goal 事件不得合并。该指标只描述使用事实，固定无因果、无发布权；仍需
Outcome、返工、成本、Retention、负迁移和 paired benchmark 才能判断价值。

跨 Goal exact 版本可以与后续 durable Delivery Outcome 建立**结果上下文**，但不能冒充效果归因。关联必须同时
满足同 Workspace、Session、Goal、Generation，Outcome 时间不早于第一次 exact use，Goal revision 不倒退；
否则 abstain。系统保留每个 Goal 的交付 attempt，唯一 latest 为通过且此前存在非通过时只描述为 recovered；
同一 latest 时间存在冲突结果时拒绝 latest 状态、恢复和指标。指标只取唯一 latest Outcome 中 goal id 精确一致的
DSH Goal metrics；全量 rollup 与最多 20 行明细分离。该投影固定无因果、无 improvement claim、无发布权，不能
改变 Candidate、评测、晋升或回滚资格。

### 3.3 Goal，而不是 Mission

保留 DSH 原生 Goal 作为唯一用户可见的长期目标概念。允许增强 Goal 的完成验证、预算、连续性、常驻监督和崩溃恢复，但不增加 Mission、第二套目标标识、任务 DAG 或平行工作流数据库。

### 3.4 人类可充分交互的控制面

EvoForge 不能只在后台“自主运行”。DSH Command、DSH TUI、随 Host 组合的 Web client 或消息 Adapter 可以投影同一组 DSH 权威状态，使用户能够：

- 查看当前 Goal、执行阶段、最近动作、阻塞原因和下一步；
- 查看 Capability Map、Capability Gap queue、实际路由结果，以及 Skill 的来源、scope、版本、内容哈希、验证状态、使用与效用证据；
- 查看 Candidate 的主张、diff、评测证据、token、缓存影响和权限变化；
- 查看候选谱系、baseline/candidate/holdout 分数、失败归因、安全扫描、quarantine、成本、时延和当前 Generation/release tag；
- 查看飞书连接身份、route、健康、入站去重、出站投递与 uncertain 状态，但不在浏览器中绕过静态 route 与 DSH Approval；
- 执行 approve、reject、pause、resume、promote 和 rollback；
- 明确区分建议、等待人工、已授权执行和 Protected Action；
- 在不回复进化审批时继续正常会话和其他 Goal。

交互状态属于 host/control plane。除非模型执行任务确实需要，不得为了 UI 刷新而新增模型工具、动态 system prompt 或每轮状态注入。

任何新增或修改的 Web/GUI 交互除了自动化组件测试，还必须使用真实浏览器控制完成端到端验收，覆盖用户可见路径、刷新后的权威状态和关键失败反馈；不能仅凭 DOM 单元测试或截图宣称前端完成。

### 3.5 Hermes 上位目标

“上位替代”按真实结果验证，不按功能数量或宣传语判断。目标矩阵至少覆盖：软件交付、单机持续运行、会话与 Goal 连续性、Memory/Skill、消息和日程 Adapter、人类控制、权限、成本、KV Cache、持续进化证据和回滚。首版不承诺复制 Hermes 的全部渠道，也不把单机崩溃恢复称为高可用。

## 4. 扩展与上游边界

EvoForge 是新增功能项目，不是 DSH Bug 修复项目。

候选插件必须通过 `upstream-fixed test`：假设 DSH 完全正确，该插件是否仍然提供独立、用户可感知的价值？如果答案是否定的，它就是 Bug workaround，应当生成最小复现并反馈 DSH 上游，而不是进入 EvoForge 路线图。

允许：

- 新工作流、新集成、新自治能力和新用户结果；
- 诊断、版本检查和生成上游最小复现；
- 通过 DSH 已支持的接缝进行组合。

不属于产品：

- Monkey Patch 或影子实现 DSH 核心；
- 修复 DSH Session、Hook、插件加载、资源释放或 UI/CLI 自身缺陷；
- 因上游修复即可失去价值的长期兼容补丁。

## 5. 权限与外部动作

默认允许 Agent：

- 创建和管理 worktree；
- 编辑代码与文档；
- 运行测试、构建和本地验证；
- 创建 commit；
- 创建 Draft PR。

以下动作必须由人工或明确部署策略批准：

- merge；
- 发布和生产部署；
- 读取秘密；
- 付费操作；
- 扩大权限；
- 不可逆外部动作。

持续进化不能绕过上述边界。模糊候选的审批与正常会话分离，审批等待不能阻塞原任务。

本仓库自身的产品开发与上述“软件交付插件可为用户仓库创建 worktree/Draft PR”是两个不同边界。
`dsh-evoforge` 开发只在 `main` 上进行小步、可验证的 commit，并在每批验证后实时 push 到
`origin/main`；不得为功能或发布创建新分支，不得 force-push 或重写已推送历史。运行时 Evolution
Candidate 使用隔离、内容寻址存储，不使用 Git branch 表示。只有冻结的核心能力集合通过完整 release
gate 后，才在 `main` 创建 annotated semantic tag；普通进度提交不得打发布 tag。

## 6. 常驻运行与恢复

第一阶段只要求单机常驻进程和崩溃恢复，正式称为 Local Continuity，不设计分布式调度、选主或多 Worker 平台。对 exact 持久 Session 的原生 active Goal，可由默认关闭的部署策略预授权 cold-resume continuation；仍复用原生轮次、权限和进程管理，不引入 Mission 或任务库。High Availability 留到存在明确可用性目标和多个故障域后再设计。

进程层只允许一个薄的用户级 OS adapter：输入 exact absolute Node/DSH entry、profile、`DSH_HOME` 和
workspace，输出可审查的 launchd/systemd unit。OS service manager 与 unit 是唯一权威；不得再建 daemon、
进程状态数据库或通用 supervisor API。安装、启动、停止和删除属于 Protected Action，必须逐次确认或由
明确部署策略授权；unit 不复制 shell `PATH` 或秘密环境变量。

常驻能力应：

- 复用操作系统服务管理器完成进程拉起；
- 复用 DSH Session Persistence、Goal、Jobs、Schedule 和 Storage；
- 使用少量、幂等、可恢复的后台状态；
- 在进程终止后识别未完成的候选生成、Trial 和晋升步骤；
- 不尝试修复 DSH 已损坏或丢失的核心状态。

## 7. KV Cache 第一原则

保护 DSH 的 KV Cache 优势是所有插件的共同第一优先级，不是某一个缓存插件或检查器的单独职责。

所有设计必须遵守：

- 同一会话内模型可见前缀、工具名、Schema 和排序保持稳定；
- 动态状态通过已有稳定工具按需读取，或存储在模型上下文之外；
- 无事发生的 Hook 真正 no-op；
- 不反复注入时间、UUID、全量历史和运行状态；
- 后台观察和持续进化不增加动态模型工具或系统提示；确有 Goal 执行动作价值的固定 Tool 必须逐项声明、
  跨轮稳定，并证明移除该声明项后其余完整请求与原生控制组等价；
- UI、审批、时间线和运行状态从 host/control plane 读取，不通过每轮 Prompt 注入同步；
- 能力晋升在会话边界生效，活动会话固定版本；
- 对完整 composition 测量缓存影响，而不是用局部插件自证；
- 缓存明显退化且没有足够收益的候选不得自动晋升。

## 8. 简洁与插件化原则

- 新能力优先作为 EvoForge Suite 内独立、可选、可删除的 out-of-tree 插件或能力包；只有独立生命周期或信任边界成立时才拆仓。
- 优先组合 DSH 原生 Service；只有真实变化点才建立新接缝。
- 一个公共接缝原则上需要至少两个真实 Adapter；否则先保留为插件内部实现。
- 设计深模块：用户学习很小的 Interface，复杂度隐藏在实现内部。
- 不为“以后可能需要”预建通用平台。
- 不建设 Mission、通用任务 DAG、平行事件溯源、Effect Broker、分布式 Lease、第二套审批语言或第二套 Memory 平台。
- 已有成熟社区插件能够解决的问题优先复用、组合或提供兼容指导。
- 每个候选插件必须回答：服务谁、解决什么问题、为何 DSH 原生组合不足、如何测量效果、如何保护缓存、如何卸载和回滚。
- 无法回答上述问题的设计不进入开发。

## 9. 设计阶段交付物

设计阶段必须交付：

1. DSH 完整架构报告；
2. DSH 全量原生插件目录及统计口径；
3. DSH、Claude Code Rev、Hermes 跨项目比较；
4. Hermes 持续进化机制专项审计；
5. 用户核心痛点与证据报告；
6. `CONTEXT.md`；
7. 必要且精简的 ADR；
8. EvoForge 插件目录、仓库边界和取舍依据；
9. 插件接口规范；
10. 分阶段开发路线图；
11. 可执行的 DSH 插件开发 Skill；
12. 持续进化架构、评测、晋升和回滚规范。

所有报告使用中文；源码符号和正式包名保留英文。报告应提供源码路径或一手来源，使读者能够自行验证。

## 10. 工作顺序和完成条件

基础研究与既有 P0A–P3 实现已经形成，但 2026-08-18 的生态增量调研和产品方向纠正带来新的现行顺序：

1. 只在 `main` 收拢并持续推送可验证现状；先修复 clean checkout、全包检查和 DSH 原生安装基线，禁止用新分支掩盖集成状态；
2. 同步更新需求、领域模型、增量调研、ADR、产品架构、路线图和验收记分卡，冻结“无开场选路、三平面、双速进化、独立评测、main/tag”约束；
3. 以 test-first 方式补齐自然语言 Goal 到 Capability Map/Gap/Skill Opportunity 的内部经验自我发现、稳定 identity/scope/version 与整包候选；运行时不搜索、下载、获取、导入或安装外部 Skill；
4. 把在线快环与离线慢环接入现有 Candidate/Trial/Generation，并证明 Candidate 无法影响 evaluator、holdout、gold 和晋升规则；
5. 在 DSH Web 中形成可解释的能力、缺口、候选、评测、回滚和飞书健康视图；关键动作继续走原生 Command/Approval；
6. 完成 `dsh-gateway` 的 Adapter 生命周期、标准化、身份/Session 映射、持久投递、幂等重试、去重、路由、限流和诊断，并完成 exact 飞书 route 的消息/Command/Approval/投递闭环；飞书文档/知识库/云盘/多维表格按独立最小权限作为 `dsh-feishu` 的 Agent-scoped 原生 Tool 接入，不进入 Gateway；Gateway 不得成为第二 Agent Runtime 或巨型业务平台；
7. 用干净 profile、真实浏览器、真实飞书、真实 provider、长期 outcome 和与当前固定 Hermes revision 的 paired benchmark 验收；只有核心集合全部通过才创建首个 annotated semantic tag。

旧阶段的 Git 提交仍保留完整审计历史；已撤销的运行时架构、控制面合同和完成证据不再作为活动文档保留。历史不得凌驾于上述现行顺序，也不能把既有实现数量当作新目标完成。

当前进度说明：软件交付、Runtime Readiness、Telegram、飞书第二 Adapter 与单用途 Evolve 注意力桥
已分别以独立 `dsh-*` 包实现；飞书真实 App 身份请求、WebSocket 握手与 setup-only 配对 transport 已
通过；同包 DSH Web Client Module 已从最终 tarball 在全新 profile 完成生成/复制/取消的真实浏览器验收，
并只复用当前 Session 的 `/feishu-pair` 生成待审查静态 route，消除手工查 ID 和拼命令的负担。
exact route 消息和 Hermes paired 证据完成以前仍只标记为 `implemented`；公共渠道可靠性中的 ingress、
普通文本 outbound intent/journal、幂等、按 account 串行、明确限流重试和脱敏状态已经收敛到
`dsh-gateway`。Gateway 入站现接受 exact 文本与 DSH 原生 `ImageAttachmentRef`；飞书 Adapter 通过官方
message-resource 端口下载图片，整批按 `ctx.attachments` 限制校验并内容寻址持久化，外部 `fileKey` 不进入
Session。assembled DSH 已证明原生 image block 和 exact bytes 回读，但尚未证明真实用户消息或真实多模态
provider。飞书 Approval 卡片现已沿 thread-scoped exact route 发送，并将一次性 nonce 与平台 card message id、
exact chat/operator 共同绑定；错误卡片、错误身份、重放和 dispose 均由 assembled DSH 门禁拒绝或取消，
但真实用户点击仍未验证。固定 DSH attachment v1 没有通用文件契约，普通文件和音视频仍不能发明 Gateway
file block。文档、知识库、云盘元数据和多维表格已按四个默认关闭的独立权限实现为 Agent-scoped 原生
`feishu_content_read` Tool；每次读取走 ToolRuntime/Approval，当前 Session schema 固定，结果进入原生 durable
`tool/result`，不另建 Store 或 Gateway 内容路由。assembled DSH 已验证权限拒绝、审批、官方 SDK 映射、边界、
取消和 dispose。V5.6 又把四权限、exact Agent Tool registry、Approval seam 和 request header 组成 V2 Host
权威内容就绪投影；最终 tarball 已在真实 DSH Web 验证人工刷新、Host 停机清空旧状态和同端口无 reload 恢复，
且健康读取不调用模型或平台。真实 App scope、资源成员权限和真实内容仍未验证。平台协议、凭据、实际发送、卡片和 transport lifecycle 留在 Adapter；Adapter 只把
exact route 所属的脱敏 transport observation 注册到 Gateway 权威健康投影，也不把
其他消息、内容或日程需求视为已交付。该说明不改变以上需求顺序和权限边界。

Gateway 权威 `healthSnapshot()` 只能从静态 route、原生 Agent 注册表、Gateway ingress/outbound journal
和 Adapter registrations 读取，按 exact route 子集返回生命周期、live Session、ingress、transport 与 outbound 状态；
不得输出 account/chat/user、正文、external message id、错误正文或凭据，不得调用模型或平台。公共
outbound 和 Adapter transport observation 已由 Telegram/飞书共同验证并迁入；统一 Gateway Web 已由同包
官方 Client Module + 只读生成式 Remote 实现，并从最终 tarball 在真实 DSH 浏览器验证读取、刷新、Host
停机清除旧快照和同端口恢复。该门通过不代表 exact 平台消息已完成。平台 SDK、重连策略和错误正文不得进入 Gateway。

内部经验自我发现的现行纵切只使用 DSH 内部经验。已有能力继续由模型依据原生完整 Session Skill catalog
自主路由并由原生 `skill` Tool 加载；没有适用 Skill 时，模型可在同一自然语言 Goal 中调用唯一稳定的
`report_capability_gap` Tool 提议一个有界 kebab-case 能力名。Host 重新核对 exact Workspace/Session、active
Goal、完整 settled catalog 和 exact name 不存在，再持久化 `model-declared-skill-gap`；原生 `skill` exact miss
仍作为另一类内部证据。用户不选择路径、Agent、工作流、Skill 或来源。该 Tool 的名称、描述、Schema 和顺序
在 Session 内稳定，移除它后其余请求保持原生 composition 等价。

`ExperienceDrivenSkillOpportunityDiscovery` 以同一 Workspace 的 durable、Goal-linked Gap 决定资格。至少两个不同
Goal 对同一能力形成重复证据才派生一个 `eligible-for-authoring` Skill Opportunity；同一 Goal retry、无 Goal、
跨 Workspace 或证据不足都 abstain。Opportunity v3 只关联能够从 feedback 目标回答的 durable Session turn 中
证明唯一成功 Skill 调用并折叠出 exact Goal id/revision 的明确纠正；同 Session Gap 接近关系不构成归因。它还可关联
同一稳定 Goal id 跨 revision 的唯一 Gap Skill compact delivery outcome；Outcome 必须不早于对应 Gap 且 revision 不得倒退，歧义事件不关联，固定
`causalClaim: none`，也不能改变资格、排序或 author 输入。Workspace 级 `selfDiscoveryPolicies` 只授权 owned run root 与日预算，
不接受 Skill 名、路径、来源或工作流；Skill 名只能来自 Opportunity。Opportunity 本身不等于 Candidate readiness：
`SkillEvaluationEvidenceVault` 必须先从 exact Opportunity 快照中选出至少四个不同 Goal，内容寻址密封 authoring、
admission 与 holdout 三组不重叠样本；存在第五个或更多独立 Goal 时，另保留一个专属 Retention 样本。作者只接收 authoring 子集及密封 id，admission/holdout/Retention objective 不进入 proposer
请求。少于四个 Goal、快照不一致、symlink 或密封内容篡改均在预算和模型调用前 abstain/fail closed。原生 Jobs
中的 author 不能执行外部搜索，返回 root `SKILL.md + references/*.md` 的 instruction-only whole-Skill manifest。
Host 确定性组装 archive；Candidate v2 将 exact evaluation-evidence seal id 纳入内容身份，并绑定 opportunity/gap/goal/model/input/artifact/tree 血缘，只写入 quarantined、
inactive、unevaluated、never-executed Candidate。可能已经付费但结果未知时持久化 `uncertain` 并拒绝盲重试；
取消后的迟到响应不得落候选。该模块没有安装、激活或发布接口。

现有 Skill 改进与上述缺失能力路径分轨。feedback 目标回答的唯一成功 Skill 调用必须从 durable Session 计算模型实际看到的 invocation content-block hash；只有同 Workspace、同 Skill 名、同 hash 在至少两个不同 Goal 中收到去重负向纠正，才形成独立调查。历史无 hash、同 Goal retry、重复 Signal、同名不同内容版本或歧义全部 abstain。该 hash 不是完整 Skill package/tree/version，固定 `causalClaim: none` 且不能被 capability-absent Envelope 或 Candidate Repository 消费。Host 必须在调用发生时封存完整受信 Bundle，再重验调查快照和每个 exact `(Session, invocation seq)` 引用；只有 route/Skill/hash 一致且全部解析到同一个 baseline id，才生成内容寻址的 `eligible-for-existing-skill-authoring` 资格。引用缺失等待，证据漂移、archive 损坏、归因错配或多个 Bundle 均 invalid。

该资格达到至少四个不同 Goal 后，Host 必须通过官方 `MessageFeedbackService.list()` 与 `SessionPersistence.inspect()` 重新读取当前纠正和 exact durable Goal/用户请求；禁止从私有 DSH storage table 或 reference-only Signal 偷取正文。message/version/time、assistant、唯一 Skill invocation、route/seq/content hash 和 Goal revision 必须全等。证据在 Candidate 调用前确定性分为至少两个 authoring、一个 admission、一个 holdout；第五个及以上再隔离一个 Retention；同 Goal 重复不计。proposer 只可见 authoring cases，治理面保留其余样本，Remote/Web 只显示 identity、计数和阻断原因。少于四 Goal 不读取纠正文；feedback/Session 漂移、服务缺失、内容超限和 seal 篡改均 fail closed。

Candidate proposer 调用前，独立 existing-Skill holdout governance 必须只接收 exact Opportunity、Qualification、完整 baseline、Evidence Seal identity、proposer identity hash 和唯一 protected holdout；禁止接收 Candidate、diff、claim 或 capability-absent subject。governance author 与 proposer identity 相同必须在预算前阻断。Host 只接受保持 name/license/permissions/allowed-tools 的完整 correction `SKILL.md` 与 assembled evaluator，并将 baseline 的其余 references/assets/binary 原样继承为 synthetic known-bad 与 known-correction 完整树；Case Pack 必须是 `dshAssembled: true` 的 `skill-tree` subject，不得含 `capabilityAbsentBaseline`。零 proposer calibration 未证明 known-bad fail / known-correction pass 时不得安装 Envelope。预算延期可恢复；paid-call uncertain、校准失败、identity/content drift 均不得盲重试。该治理必须在原生 DSH Jobs 内先于 proposer 执行，失败时 proposer budget/model call 为零，且始终无 effect verdict 或 release authority。

受保护的 existing-Skill author 必须自主从上述内部机会取任务，不接受用户选择的 Skill、路径、来源或工作流，也不得做外部搜索/获取。它只能看到 exact baseline 的有界文本、二进制资源元数据和 authoring cases，只能提出 root `SKILL.md` 与一层 `references/*.md` 的文本替换/新增。Host 必须拒绝 delete/rename/path drift、Skill identity 漂移、代码/二进制改写、no-op、超限及 `permissions`/`allowed-tools`/`license` 漂移，并从 baseline 原样继承所有未修改文件后组装完整内容寻址 archive/tree。paid call 前必须持久化 intent；未观察结果或重启发现 pending 时标记 uncertain 且不盲重试。Candidate 必须独立于 capability-absent 新 Skill schema/storage，固定 inactive/quarantined/unevaluated/never-executed/no-release-authority；Web 只能显示持久 phase/cost、identity、tree 和 bounded diff，不得下发 claim、正文、保护样本或 Host path。

existing-Skill Candidate 必须进入独立于 capability-absent Envelope 的 Host 结构准入。该门禁只按 exact Workspace/baseline 内容地址读取已封存完整 Bundle，并从 Candidate vault 物化 exact 整包；它必须绑定 qualification/evidence/authoring digest 和 governance-only admission 样本，重算两侧 archive/tree，逐字确认所有未修改文件，且实际 changed/added/preserved/binary 与 Candidate 声明完全一致。删除、未声明 diff、非 `SKILL.md`/一层 `references/*.md` 差异、identity/evidence 漂移均阻断。运行 state/result 必须内容寻址、加锁、可恢复并由原生 DSH Jobs 调度；通过只表示 `qualified-for-holdout`，明确 `candidateExecuted: false`、无效果判决和无发布权。

结构准入后必须由独立 existing-Skill exact paired holdout 重读 immutable baseline、exact Candidate、qualified Admission 和 Candidate authorship/content identity 已绑定的 exact Candidate-blind Envelope。新 Candidate 必须把生成前 Envelope id 纳入内容身份；五 Goal Envelope 必须由两个单样本治理调用分别形成并绑定 Holdout/Retention Case Pack 与输入摘要，四 Goal和 legacy v2 必须显式没有 Retention。可读 legacy 无绑定 Candidate、Envelope id 错配或事后 lookup 到另一个 Envelope 都必须在 Candidate 物化和 Trial 前失败关闭。运行 identity 必须绑定 Candidate/Admission/Envelope/Opportunity/Qualification、三棵内容树和固定 DSH revision；两侧完整 `skill-tree` 进入相同 assembled DSH Trial，禁止 capability-absent subject。Trial 前后都要重算 baseline/Candidate/Case Pack；只有 known-bad/known-correction calibration、assembled execution、非目标 composition、输入完整性和四次 Trial 全部成立才可分类：`fail/pass → improved`、`pass/pass → ambiguous`、`fail/fail → not-improved`、`pass/fail → regressed`。物化漂移必须 `protected`，明确失败或完整性失败必须 `incomplete`；付费 dispatch 前持久化 pending，重启发现未知结果时不得盲重试。该评测只产生无发布权证据；Retention、Canary、晋升和回滚仍须独立门禁。

Delivery Outcome 可附带同一 Session、同一稳定 Goal id 的 `GoalExecutionMetrics`。Host 只统计首条 admitted
message 属于当时最新 active Goal revision 的 turn，并在 exact `complete_delivery` result event 截止；token、
cache-read/write、LLM/tool/TTFT/decode 时间来自 DSH 官方 `tokenUsage`/`sessionStats` projection cut 的差值，
active wall time 来自同一原生 turn 边界。手工 turn、其他 Goal、旧 revision、归属歧义、缺少 projection unit
或计数倒退全部 abstain。DSH 没有提供 provider price 时货币成本必须明确为 unavailable，禁止自行估价。
这些 metrics 只进入 Host 权威 compact Outcome 事实，不改变 Opportunity 资格/排序、author 输入、评测 verdict 或晋升。
`EvolutionControlPlane.overview` 只输出 browser-safe 聚合与至多 20 条最新已测 Outcome；不输出 Session/call/reason/path，
不建立第二 metrics API 或浏览器状态权威。缺失 metrics 必须显示为未测，不能折算为零。

DSH Web 已投影 `Capability Gap → Skill Opportunity → Candidate → authoring state`，并将 existing-Skill improvement investigation、exact baseline qualification、correction evidence readiness、Candidate-blind holdout governance、paired structural admission、exact paired holdout effect verdict 与 exact Retention 作为独立队列展示。existing-Skill Candidate 行显示其生成前绑定的 exact Holdout Envelope id；Retention 行显示 Candidate/Holdout/Admission/Envelope、baseline/Candidate/Holdout/Retention tree、四象限、calibration/assembled/composition/integrity、model/token/cache 与无晋升/发布权。页面另显示证据 Goal 数、Gap/纠正数、baseline provider/source/id/文件数、authoring/admission/holdout/Retention 分区、holdout phase/cost/retry/failure/Envelope identity、结构准入 status/reason、baseline→Candidate tree、声明 diff 计数、protected admission 摘要、paired Candidate/Admission/Envelope、三棵树、双方 pass/fail、calibration/assembled/composition/integrity、model/token/cache、资格或阻断原因、
关联纠正/Outcome 计数、有界短引用、无因果声明、Candidate id、预算/调用和隔离状态，并展示 Host 权威的
Workspace/current/baseline Goal 执行聚合、最近已测 Outcome、token/cache/latency/active-wall facts 与价格 unavailable；
Opportunity 另显示评测证据是等待、无策略、无效、具备密封条件或已密封；凡 Gap 已进入 Opportunity，浏览器
投影都移除 Goal objective。具备密封条件或已密封时只显示 evidence id、authoring/admission/holdout/Retention 数量和
proposer 不可读保护声明，不返回受保护样本内容。
Candidate 进入后，浏览器谱系显式显示 `Opportunity → evidence seal → Candidate → Admission`，不会用 Envelope id 隐去生成前封存版本。实际 assembled Shadow 继续由 `ReviewInbox` 校验，Retention 继续由其内容寻址 run root 校验；Host 只有在 Workspace、Skill、Candidate、Admission、Envelope、Shadow run、baseline tree 和 Candidate tree 全部一致时才投影同一行。错配、重复、篡改或不可读状态必须 fail visible，不能把 Retention 显示成通过；浏览器只接收 bounded case、trial、composition、verdict/reason、calibration、proposer/model/token/cache 聚合和 lineage，不接收 Host path、protected Goal/Case、evaluator、provider identity 或 proposal。
不提供路线、来源、安装或激活菜单。刷新失败必须显式报错并保留最后一次成功快照，恢复后从同一 Host 权威重新读取。旧的本地 Git、外部索引和运行时
Web research 方案必须从当前实现删除；其已撤销的架构与 evidence 页也从活动文档删除，决策原因只由 superseded ADR 和当前调研基线保留。Hermes、OpenClaw、HanaAgent、论文与开源实现继续用于设计期固定 revision 调研与 paired benchmark，不进入运行时 Skill 路径。

确定性 admission、assembled Shadow、Review、immutable Generation、future-Session promotion 与 rollback 的既有
治理路径仍保留。内部 Candidate 不再由 profile 预选 exact Skill、baseline 或两套 Case Pack；Workspace 级
`candidateEvaluationPolicies` 不接受 Skill、baseline、Case Pack 或 Candidate 方向；自主治理时只额外固定 exact DSH revision 和独立日预算。Host 根据 Candidate v2 的 exact evidence-seal id 读取受保护 admission/holdout/可选 Retention；治理作者分别只接收自身样本且不接收 Candidate 文件、正文或 id。治理作者与 Candidate proposer 的模型身份相同时必须在预算预留和模型调用前失败关闭；全部 Case Pack 先以零 proposer 调用校准，再按 `Opportunity/evidence-seal` 原子安装。
Envelope v4 严格绑定四 Goal 路径；存在 Retention 样本时使用 v5，额外绑定其 protected input digest、独立 assembled Case Pack hash 与 run root。两者都绑定 Opportunity 快照、`Skill Evaluation Evidence Seal`、author-input digest、治理作者 identity，只能含 `subject.json` 的 capability-absent baseline、calibrated admission 和不同的 assembled holdout；baseline DSH 不安装目标 Skill，Candidate 侧才安装 exact
whole-Skill，任何占位 `SKILL.md` 都 fail closed；
Opportunity/内容/路径不一致、任意 protected Case Pack 同 hash 或符号链接均 fail closed。同一 Envelope id 进入
admission、Candidate Lineage v3 和 Shadow handoff；lineage 另显式携带 seal id，结果仍无 release authority。治理作者请求 dispatch 后结果不可确认时持久化 `uncertain`，重启不得盲重试。

该实现已消除人工预定进化方向，并完成生成前的独立证据密封、新 Skill 的内容寻址发布、future-Session 固定、root rollback、exact-Candidate assembled Shadow，以及同一 Jobs 任务内对 Envelope v5 第五 Goal Case Pack 的内容寻址 Retention verdict。旧静态 Retention/canary 编排已删除；新 Retention 不读取 target、不调用 proposer、不授予发布权。独立 Host Promotion Eligibility 每次晋升前重验 approved Review、Generation artifact、Lineage、Shadow 和唯一 Retention run；missing/prepared 等待，warning、歧义、错配、regressed、incomplete 和 verdict/evidence 脱钩均阻止 active selection，Command 与 Web 不得绕过。新的 failed-Outcome canary 只从该 exact internal evidence 重建，内容寻址重跑 Retention Case Pack 并产出 keep/review/rollback-eligible；它没有 Generation mutation seam。
已实现把已密封 admission/holdout/Retention Goal 样本交给 Candidate-independent 治理作者、零 proposer 校准并形成 Envelope v4-v5；existing-Skill 路径也已把 exact Admission、baseline、Candidate 与 Candidate-blind Envelope 接入 assembled paired holdout 并持久分类，但尚未用两套独立真实 provider 与真实 assembled Goal 样本证明生成包可用，也未在长期任务中
完成 admission→holdout→Retention→canary→outcome 的整链归因。下一阶段必须让
Candidate 不可读写的 Evaluation Governance Plane 在真实 provider 下证明 baseline、未见样本和 hard gates 有效；没有合格治理包时 abstain，不能回退到外部搜索、author 自评、Mock 结果或一次成功即晋升。

`dsh-software-delivery` 的最小 objective outcome 已作为内部交付事实。失败 Outcome 本身不证明 Skill 回归；只有 exact Candidate/Envelope canary 在 baseline 通过且 Candidate 失败时才能形成 `rollback-eligible` 证据。该证据不直接回滚；后续独立 Host action 必须再次重验 exact pointer 和权限，人工复核的新 Skill不会被实验性 policy 静默改写。

验证器之后只增加一个最小原子 `complete_delivery` Tool：复用原生 shell policy 和
`update_goal`，通过才完成 exact native Goal。它不是 Mission、全局 Goal 拦截或第二套 policy；
若真实使用没有证明需要，不扩张为通用 workflow engine。

Draft PR 继续复用同一个 Tool 的可选参数，不再增加模型动作。默认只做非强制 exact commit push、
创建或复用 Draft 和 read-after-write；不 merge、不转 ready。远端 branch/PR 是幂等事实源，
网络结果不确定时 Goal 保持 active，重试先查询而不是盲目重复外部动作。

仓库可通过默认关闭的 host 配置要求 exact Draft PR head 至少有一项且全部远端 checks 通过后才
完成 Goal。该配置不改变 Tool Schema；默认每次调用只读一次远端事实。部署者可另行配置有上限的
active-call wait，只对 pending/缺失 checks 重读，不保存 CI journal、不复制日志，也不启动后台
watcher。failed、无法读取或 head 漂移立即保持 Goal active；timeout 后显式重试仍复用同一个 PR。

反馈进化只复用原生 Message Feedback 保存 reference-only Signal。目标 Skill 只能从 durable Session 的唯一成功 `skill-invocation`、exact Goal id/revision 与 invocation-content hash 归因，用户不能指定 Skill 或处理路径；歧义、同 Goal 重复和 legacy 无 hash 一律 abstain。Signal 与 Gap、Outcome 进入内部经验聚类，达到跨 Goal 门槛后才形成 Opportunity、Evidence Seal 和隔离 Candidate。

Candidate 作者、评测治理面和执行面必须分离。作者只读 authoring 子集；治理作者分别只读 admission/holdout/Retention，且不能读取 Candidate；Shadow 只接收 exact Candidate、lineage、Envelope 和 `dshAssembled` Trial，不调用 proposer、不选择 target、不生成任何 Draft。评测或持久状态不完整时 fail closed，不以自动过期替代明确治理决定。

Retention、反事实 Canary、持续监测和低风险自动晋升必须直接绑定内部 Candidate/Envelope/Outcome，使用 baseline/candidate 对照、未见样本、负迁移、安全、权限、成本、时延、cache、故障恢复和精确回滚证据。当前缺失 Skill 的 Retention/Canary/Rollback，以及 existing-Skill Retention/发布门/failed-Outcome Canary/独立 rollback gate 已按该边界重建；两条路径都已完成最终包 rollback 故障恢复。真实 provider、长期率和 full paired 门禁仍属 pending。任何阶段都不能复用已删除的静态 target、Feedback Draft、Evaluator Draft 或旧 journal。

研究完成的标准是“当前 revision 的每一个原生插件都有归类和作用说明，三个项目的关键结论都有源码证据”。设计完成的标准是“每个计划插件都有用户结果、DSH 接缝、缓存影响、权限边界、验证方法和回滚方案”。实现完成的标准由相应 P0 测试规格定义。

## 11. 已确认的关键决策

- 持续进化是旗舰功能；软件交付是第一试验场。
- `deepseek-harness-evoforge` 是所有 DSH 扩展设计和开发的公开组织；相关插件默认共仓，独立生命周期或信任边界成立时拆仓。
- 只使用 Goal，不设计 Mission。
- EvoForge 只增加功能，不承担 DSH 核心 Bug 修复。
- 新能力优先 out-of-tree、插件化、可独立安装和卸载。
- 首个在线阶段 P0B 为单机、常驻、可崩溃恢复，不做分布式系统；离线 P0A 不预建 daemon。
- 明显正向的指令改进可以自动晋升；模糊结果异步人工复核。
- 可执行变更默认生成 commit/Draft PR，不自动 merge 或激活。
- 所有能力版本可回滚；外部副作用仍由原生审批和补偿流程负责。
- 所有插件共同以 KV Cache 稳定为第一设计约束。
- 先证明 evaluator 与 Candidate 有用户价值，再建设在线发布底座；不能用基础设施完成度代替进化效果。
- 首个仓库为 `dsh-evoforge`；公开插件和独立插件仓库使用 `dsh-*` 命名，首个插件为 `dsh-evolve`。
- 项目所有者只负责最终产品验收；命名、开发方式和验证路径由维护 Agent 按本需求基线自主决定。
- 涉及前端时必须补充真实浏览器端到端验证，并保留可复核结果。
- 设计基线已经确认，按 P0A Shadow 契约 test-first 实现。
- 用户只提供自然语言 Goal、材料、约束和验收条件；系统内部自主发现并选择 Skill/路径，不提供开场路由菜单。
- 自进化采用稳定执行面、隔离进化面、独立评测治理面，以及在线快环/离线慢环；没有充分证据时必须 abstain。
- 从内部证据归纳生成的能力只能先成为可追踪、可隔离、可评测的完整 Skill 包 Candidate，不能静默安装到活动 Session。
- “自我发现 Skill”只指从 DSH 内部 Goal/失败/纠正/outcome/复用与保留证据发现应形成或改进的能力；外部生态调研是设计期输入，不是运行时自我发现。
- `dsh-evoforge` 自身只在 `main` 小步提交并实时同步 `origin/main`；核心门禁通过后才用 annotated semantic tag 标记迭代。
- 飞书是首批正式集成能力，Web 必须可视化能力图、缺口、候选谱系、评测/成本/安全/回滚与飞书健康，但不得成为第二权威控制面。

## 12. 相关设计文档

- [领域语言与不变量](../CONTEXT.md)
- [EvoForge 产品架构](architecture/evoforge-product.zh.md)
- [Hermes 上位目标验收记分卡](architecture/hermes-replacement-scorecard.zh.md)
- [持续进化架构](architecture/evolution-design.zh.md)
- [插件目录](plugins.zh.md)
- [插件接口与验收规范](plugin-contract.zh.md)
- [开发路线图](roadmap.zh.md)
- [可执行 DSH 插件开发 Skill](../skills/build-dsh-plugin/SKILL.md)
- [全新失败 evaluator authoring Skill](../skills/author-dsh-evolution-case/SKILL.md)
- [用户痛点证据](research/user-pain-evidence.md)
- [公开自进化项目证据审计](research/public-self-evolving-agents.zh.md)
- [DSH 插件组、自进化与个人 Agent 生态增量调研](research/ecosystem-frontier-2026-08-18.zh.md)
- [ADR：只增强原生 Goal](adr/0002-extend-native-goal.md)
- [ADR：只做扩展，不修核心](adr/0003-extensions-not-core-repairs.md)
- [ADR：持续进化作为旗舰](adr/0004-evidence-driven-evolution-is-the-flagship.md)
- [ADR：EvoForge 仓库边界](adr/0005-evoforge-repository-boundaries.md)
- [ADR：自我发现采用三平面双速闭环](adr/0046-autonomous-skill-discovery-uses-three-planes-and-two-speeds.md)
- [ADR：main 是实时开发线，tag 只标记验证发布](adr/0047-main-is-the-live-development-line-and-tags-mark-verified-releases.md)
- [ADR：自我发现只从 DSH 自身经验学习](adr/0048-self-discovery-learns-from-dsh-experience.md)
- [ADR：渠道 Adapter 共享一个薄型 DSH Gateway](adr/0049-channel-adapters-share-one-thin-dsh-gateway.md)
- [ADR：渠道图片只以 DSH 原生附件引用进入 Session](adr/0069-channel-images-enter-dsh-as-native-attachments.md)
- [ADR：Gateway Web 是只读 Host 权威投影](adr/0060-gateway-web-is-a-read-only-host-projection.md)
- [2026-08-19 目标重新对齐审计](audits/2026-08-19-goal-realignment.zh.md)

若后续对话改变已确认要求，应在同一轮更新本文相应章节；历史架构文档不得凌驾于本需求基线。
