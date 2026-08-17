# DeepSeek Harness EvoForge 项目需求基线

> 状态：已确认；P0A–P1.21、P2A.1–P2D.1、P3.1、P3.2、LC-1、LC-2 和 Runtime Readiness 已有可复用实现，但 2026-08-17 产品形态已纠正为“只安装并运行于 DSH 的原生 out-of-tree 插件套件”；原生安装、多 Workspace、飞书/Telegram、Workspace-scoped evolution 与完整真实验收全部完成前不构成 v0.1 交付
> 更新日期：2026-08-17
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
真实任务结果
→ Learning Signal
→ 隔离候选版本
→ active/candidate 配对试验
→ promote / review / reject
→ 新会话生效
→ 持续监测与回滚
```

必须满足：

- 原会话不等待后台学习或人工审批；
- 反思只能提出候选，不能证明改进；
- 调用次数、复用次数、模型信心和新鲜度不能单独决定晋升；
- 明显正向且在授权范围内的指令型改进可以自动晋升；
- 模糊、主观、样本不足或有取舍的改进进入独立人工审批区；
- 每一个能力版本都可定位、比较和回滚；版本回滚不能撤销已经发生的外部副作用；
- 可执行代码、脚本、工具、权限和外部效果的自动激活受到更严格保护；
- 当前会话固定使用不可变能力版本，晋升只影响后续会话；
- 不重复实现 Hermes Self-Evolution 或通用 Prompt Optimizer；独特价值集中在 DSH 原生集成、KV Cache、Session 固定版本、非阻塞晋升、崩溃恢复和反事实回滚。

### 3.3 Goal，而不是 Mission

保留 DSH 原生 Goal 作为唯一用户可见的长期目标概念。允许增强 Goal 的完成验证、预算、连续性、常驻监督和崩溃恢复，但不增加 Mission、第二套目标标识、任务 DAG 或平行工作流数据库。

### 3.4 人类可充分交互的控制面

EvoForge 不能只在后台“自主运行”。DSH Command、DSH TUI、随 Host 组合的 Web client 或消息 Adapter 可以投影同一组 DSH 权威状态，使用户能够：

- 查看当前 Goal、执行阶段、最近动作、阻塞原因和下一步；
- 查看 Candidate 的主张、diff、评测证据、token、缓存影响和权限变化；
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
- 后台观察和持续进化默认不增加模型工具与系统提示；
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

研究阶段已经完成。后续按以下顺序推进：

1. 收敛架构、领域模型、ADR、接口规范、路线图和开发 Skill；
2. 删除重复、过重和无法说明用户价值的设计；
3. 项目所有者已授权实现方式与技术取舍，由维护 Agent 按冻结的公开接缝，以 test-first 方式实现离线 P0A Shadow；
4. P0A 必须先证明 evaluator 能拒绝坏 Candidate，并至少找到一个通过未开放 final-test 的真实改善；
5. P0A 有价值后，才实现 P0B Generation Binder、Session pin、原子晋升、崩溃恢复和回滚；
6. P0C 提供异步人工晋升；P1 才允许极窄、可证明的纯指令自动晋升；
7. 用真实结果决定后续软件交付、个人助理、内容、消息和日程插件，不一次性全部实现。

当前进度说明：软件交付、Runtime Readiness、首个 Telegram 单私聊 Adapter 与单用途 Evolve 注意力桥
已分别以独立 `dsh-*` 包实现；Telegram 仍只到自动化 `implemented`，真实 Bot/Hermes paired 证据完成以前不
扩张为 Gateway，也不把其他消息、内容或日程需求视为已交付。该说明不改变以上需求顺序和权限边界。

在 P1.1 之后，先实现 `dsh-software-delivery` 的最小 objective outcome：稳定按需 Skill 与
linked-worktree/commit/check 验证器。只有真实交付 outcome 可用后，才建设 future-session
canary 和 outcome-triggered rollback，避免先造没有可信信号的自动路由系统。

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

反馈进化先复用原生 Message Feedback 保存 reference-only Signal。只有管理者配置私有复制目录，且
用户逐条选择 signal/Skill 或部署者绑定一个静态 exact evaluator/成本策略，才保存未评分 Case Draft；
它必须重新核对 exact feedback version、Session-pinned Generation、单一 Skill invocation 和 whole-Skill
content hash。已有可信 Case Pack 覆盖该失败类型时，用户可逐次显式授权一次 Shadow，或由上述默认关闭
的部署策略每轮最多启动一个；草稿只作为 proposer 搜索证据，既有 evaluator 仍是独立裁判，草稿输入
字段不直接进入长期 run evidence（proposer 回显仍可随 Candidate 持久化）。
全新失败允许一次显式、可能付费的 evaluator authoring：结果先成为私有、不可执行的 Evaluator
Draft；host 固定生成 manifest，并用 exact active Skill 形成 known-bad，模型只能提议 evidence、
known-correction 与 evaluator。只有另一项人工决定批准 exact hash，且 sealed calibration 方向成立，
才发布 immutable Qualified Case Pack。资格成立不等于 Candidate 改善或晋升证据；后续 Shadow 仍需
另一次显式动作。不预建通用 Memory、Signal Bus 或 Case SDK。

P1.14/P1.16 的自动入口在消费日预算前，还必须复用既有 Evaluator Draft、Shadow journal 与 Review
Inbox，保证受支持的单 resident 拓扑下，同一 Skill 只有一条未决自动路径。状态不可读时 fail closed；
其余 Signal 保留在现有 Signal Store 后续再查，不新建队列或 lease，也不限制逐次人工动作。

为避免一个长期无人处理的模糊 Candidate 永久冻结同一 Skill，Automatic Feedback Target 对其自己启动、
且 evaluator 结论为 `review` 的 Candidate 提供默认 168 小时的有界窗口。只在下一条 Signal 的既有预算前
检查中复用 durable rejection；人工或明确 `promote` 候选不自动过期，不增加 timer、通知或新状态机。

Case Pack authoring 先提供零模型校准命令，不创建新 Service 或 SDK。完整 Shadow 必须在 proposer
之前用同一个 sealed evaluator 拒绝 known-bad、接受 known-correction；方向不成立时不发送付费
请求。成功路径仍是四次 Trial，校准不是额外的第 5/6 次执行。

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
- [ADR：只增强原生 Goal](adr/0002-extend-native-goal.md)
- [ADR：只做扩展，不修核心](adr/0003-extensions-not-core-repairs.md)
- [ADR：持续进化作为旗舰](adr/0004-evidence-driven-evolution-is-the-flagship.md)
- [ADR：EvoForge 仓库边界](adr/0005-evoforge-repository-boundaries.md)

若后续对话改变已确认要求，应在同一轮更新本文相应章节；历史架构文档不得凌驾于本需求基线。
