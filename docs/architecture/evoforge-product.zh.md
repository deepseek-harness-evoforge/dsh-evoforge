# EvoForge 产品架构

> 状态：产品边界已确认；Telegram、飞书两个 Assistant Adapter 与进化注意力桥已实现；内部经验驱动的 Skill Opportunity、existing-Skill exact-version investigation/完整调用时 baseline qualification/纠正证据预分区/whole-tree Candidate/结构准入/Candidate-blind exact paired Holdout 与 exact Retention、生成前独立 Goal 证据密封、seal-bound Candidate v2、Candidate-independent Governance Case Pack Authoring、Envelope v4/v5、Lineage v3、exact-Candidate assembled Shadow/Retention、独立 future-Session Promotion Eligibility、failed-Outcome sealed Canary evidence、exact evidence/human Rollback Gate 与内容寻址 Generation 已实现。V4.41–V4.45 已完成 existing-Skill Retention、发布门与最终包浏览器生命周期；V4.46 已实现其 failed-Outcome exact paired Canary Host/Jobs 纵切，且评测仍无发布权；V4.47 已用独立 Host gate 接入 Control/Remote/Web 人工 expected-active rollback。最终包 Canary/rollback 恢复、两套独立真实 provider 与长期效果仍待完成。
> 更新日期：2026-08-21

## 1. 产品结果

EvoForge 不是第四套 Agent Runtime。它让 DSH 在选定真实工作流中成为比 Hermes 更可靠、更可控、更节省缓存并能用证据持续进化的长期 Agent。

```text
人类交互面
  └─ status / timeline / evidence / approve / pause / rollback
                         │
DSH Runtime ─ Goal / Session / Tool / Approval / Storage / Jobs / Skill
                         │
EvoForge 可选能力
  ├─ Evolve：自主能力路由、缺口发现、双速候选生成、评测和发布
  ├─ Software Delivery：隔离、验证、commit、Draft PR
  ├─ DSH Gateway：静态 endpoint 绑定原生 Workspace/Session/Agent
  ├─ Telegram Adapter：一个私聊经 Gateway 持续使用原生 Agent
  ├─ Feishu Adapter：一个 App 的 exact 私聊/群聊经 Gateway 使用原生 Agent
  ├─ Evolve Attention：待处理进化决定发送到既有 Telegram/飞书 route
  ├─ Goal Continuity：授权固定 Session 在重启后继续原生 Goal
  └─ Resident：用户级 OS service 拉起 exact DSH profile
```

DSH 始终拥有模型执行和基础服务；EvoForge 插件只增加用户结果。插件卸载后，原生 DSH Session 和 Goal 仍可恢复。

## 2. 首批能力边界

### dsh-evolve

旗舰插件。现有 P0A–P1.21 已提供 Shadow、Generation、Session pin、反馈、晋升、监测和回滚底座。
用户只提交自然语言 Goal；已有能力由 DSH 原生 catalog/`skill` Tool 路由，确无适用能力时模型通过固定
`report_capability_gap` Tool 报告，Host 复核并持久化。`ExperienceDrivenSkillOpportunityDiscovery`
只从 DSH 自身 Goal-linked Gap 中找重复模式：同一 Workspace、同一 Skill、至少两个独立 Goal 才形成
Opportunity；同 Goal retry、无 Goal 和跨 Workspace 均 abstain。`selfDiscoveryPolicies` 只授权 Workspace、
run root 与日预算，不预选 Skill、路径、来源、Agent 或 workflow。Opportunity 达到至少四个不同 Goal 后，
治理面先内容寻址密封 authoring/admission/holdout；存在第五个或更多独立 Goal 时再保留一个 Candidate 不可见的 Retention 样本。原生 Job author 只读取有界 authoring 子集，
Host 将 instruction-only whole-Skill v1 内容寻址并隔离为 inactive Candidate。在线快环收集可归因
signal/gap/outcome，离线慢环负责跨 Goal 归纳、候选生成、独立评测、保留和发布。外部生态研究只用于
设计期和冻结 benchmark；运行时外部搜索不是自我发现。Self-Discovery、Observer、
Trial Runner、Decision 与 Release 在证明有两个独立消费者或信任边界以前都保持内部模块，不为了名称
数量拆成浅插件。

内部 Candidate 评测的 profile 只允许 Workspace 级 governance/run roots，不再指定 Skill、baseline 或
Case Pack。Host 以当前 Opportunity id 与 Candidate 绑定的 evidence-seal id 解析严格、内容寻址的 Evaluation Envelope v4/v5；它必须重新核对
evidence seal 与 author-input digest，再由同一 Envelope 同时
约束 deterministic admission、独立 assembled holdout 和 v5 可选的独立 assembled Retention Case Pack，并把 identity 写入 Candidate Lineage。baseline 只
允许 Opportunity-bound `subject.json`，不安装目标 Skill；Candidate 侧才安装 exact whole-Skill，禁止用占位
`SKILL.md` 冒充能力缺失。该路径已实现 fail-closed 解析、真实 DSH Shadow、Review projection 与 crash resume。
经明确复核的新 whole-Skill 会以 canonical `skill-bundle` 写入 inactive Generation；Storage 和 DSH Skill
Provider 重验 archive/digest/tree/lineage，不需要 Git source、网络或市场。独立 Host Promotion Eligibility 每次重验 approved Review、Generation artifact、Candidate Lineage、Shadow 与 Retention，missing/prepared 等待，warning/歧义/错配/regressed/incomplete 阻断；只有 exact retained 才能晋升，且仅影响未来 Session，root rollback 让后续 Session 回到 native DSH。独立 Retention 与 sealed canary 必须使用原 Shadow 的 exact absent
subject、whole-Skill tree/lineage 和 sealed Case Pack 做无 Git paired replay，非目标 DSH composition 必须一致；
它们不调用 proposer，也不扩大自动发布权限。独立 Retention Case Pack/Envelope、paired replay、durable verdict、Promotion Eligibility、failed-Outcome sealed canary 与 exact rollback gate 已实现；长期 outcome 仍未完成。

existing-Skill 路径不复用 capability-absent subject。Host 在调用时封存 exact installed Skill、从当前纠正预隔离 authoring/admission/holdout/Retention；Candidate-blind 治理在 proposer 前形成 calibrated `skill-tree` Holdout/Retention Case Pack，并把两者共同封入 Candidate 已绑定的 Envelope。V4.43–V4.45 已完成独立发布门及最终包浏览器。V4.46 在 active release 出现失败 Outcome 后，通过 Retention owner 重放 exact baseline/Candidate/Retention pair；Candidate fail 只有在 baseline pass 时才成为 `rollback-eligible`，双失败只审查，所有结果固定无 mutation 权。V4.47 的独立 mutation owner 每次重验 exact terminal evidence，并以 expected-active compare 只更新未来 Session；Control/Remote/Web 不直接写 pointer。最终包 Canary 故障恢复与真实 provider Trial 仍 pending。

### dsh-software-delivery

独立插件。它把一个原生 Goal 交付为隔离 worktree、仓库检查、可审查 diff、commit 和可选 Draft PR；仓库也可选择 exact-head 远端 checks 全绿后才完成 Goal，并可在一次 active Tool 调用内有界零模型等待。即使不启用 Evolve，它仍有完整用户价值；启用后，它提供第一组强 outcome signal。

### dsh-gateway

Telegram 与飞书共用的薄 Host 深模块。它拥有静态 exact route、进入 DSH 前的身份标准化、原生
Workspace/Session/Agent 绑定、持久 ingress/outbound journal、幂等、按 account 串行、明确限流响应、
uncertain 恢复和脱敏 transport 聚合；平台协议、凭据、实际发送、卡片与重连继续属于 Adapter。同包官方
DSH Client Module 通过无参数只读 Remote 展示 lifecycle、route、live Session、transport 和投递状态，
失败刷新必须清除旧快照。它不创建网络 server、第二 Runtime、Session、Goal、Approval 或权限体系。
入站内容边界只接受 exact 文本和 DSH 原生 `ImageAttachmentRef`。Adapter 必须先下载平台资源、按当前
`ctx.attachments` 限制验证整批并持久保存；平台 key、URL、base64 和本地路径不得进入 Gateway 或 Session。
纯文本保留旧幂等摘要，图文使用带版本的 canonical 摘要；当前不发明 DSH 尚未定义的通用 file block。

### dsh-telegram

首个 Assistant Adapter 已选择 Telegram 单私聊：一个 Bot、一个 exact private chat/user、一个静态
DSH Gateway route。Gateway 通过 WorkspaceRegistry、Agent preset 与 Session persistence 创建或冷恢复
稳定 Agent；Telegram 只保留协议轮询、Approval UI 和 outbound delivery。它复用原生 Commands、Goal
与 Schedule，不创建第二 Session 或 Gateway；0 Tool/Skill/Prompt。真实 Bot/Hermes paired benchmark
之前只标记为 `implemented`。

### dsh-feishu

第二个 Assistant Adapter 已实现为飞书官方 SDK WebSocket 长连接。一个 App 可绑定多个静态 exact
route，但 App ID 必须与 Gateway account 一致；Gateway 继续拥有 Workspace/Session/Agent/Command，
Adapter 只保留平台协议、实际发送和一次性 Approval 卡片；有界出站 journal 位于 Gateway。明确 429 才重试，模糊发送进入
uncertain。双 Workspace 双渠道同 Host 重启隔离、真实 App 身份请求及标准 HTTPS proxy 环境中的
WebSocket 握手已经通过；setup-only `/feishu-pair` 用两分钟一次性消息从当前 DSH Workspace/Session
生成待审查静态 route，不 dispatch Agent 或自动授权。exact chat/user 消息闭环完成前仍只标记为
`implemented`，不能增加通用 Gateway Runtime。
入站图片使用飞书官方 message-resource API 下载，再经 DSH AttachmentStore 内容寻址保存；assembled
DSH 已证明原生 image block、exact bytes 回读和外部 `fileKey` 不进入 Session。该证据不等于真实用户
exact route 或真实多模态 provider 验收。已验证 rc.5 与最新设计审计 rc.2 都只有栅格图片附件；普通文件、音视频以及
文档、知识库、云盘、多维表格必须走后续独立权限能力，不能由 Adapter 私有存储或 Gateway 占位消息冒充。

### dsh-evolve-attention

单用途组合插件。它只在 Evolve 已有 Candidate review 或 inactive promotion decision 需要处理时，经 `dsh-telegram` 和/或
`dsh-feishu` 已静态授权的 exact Workspace route 发送一条有界提醒；重启与重复扫描复用各 Adapter
durable journal。消息不是 Approval，动作仍走 `/evolve`，原 Session 不等待。它不创建 timer、第二
状态机、通知平台或公开 Adapter SPI，0 Tool/Skill/Prompt/Command/模型调用，普通 Session token 增量为 0。

### dsh-goal-continuity

独立、默认关闭的 Local Continuity 插件。部署者只配置 exact 持久 Session allowlist；当 DSH 冷恢复
该 Session 时，插件仅 rearm 仍 active 且未耗尽的原生 Goal，后续完全交回原生
`goal-round-driver`、轮次上限和 Approval。它不扫描 Session、不管理进程、不建 Mission、任务库或
重试平台，0 Tool/Skill/Prompt。静态授权不能区分崩溃与有意重启，因此两者都会继续。

### dsh-resident

默认关闭的进程层 Local Continuity Bundle。`/resident plan` 把静态配置中的 exact absolute Node、DSH
entry、profile、home 和 workspace 变成完整 launchd/systemd unit；只有 exact plan hash 或 service id
逐次确认后才 apply/remove。OS manager 和 unit 是唯一进程权威。插件不建 daemon、状态库或公共
supervisor API，只有 1 human Command，0 Tool/Skill/Prompt/模型调用。与 Goal Continuity 组合时，
Resident 只恢复进程，Goal Continuity 只决定 exact Session 的原生 Goal 是否被授权继续。

当前不创建独立的 Mission、Supervisor、Cache、Policy、Memory、Event Store 或通用 UI 平台插件。DSH Gateway 只抽取两个消息 Adapter 必需的 Workspace/Session/Agent/Command 入口接缝，不承载平台网络协议或第二控制面。

## 3. 交互契约

交互是产品能力，不是模型 Prompt。

所有界面 Adapter 投影同一组权威状态：

- Goal、阶段、进度、阻塞原因和下一步；
- Capability Map、Capability Gap queue、实际路由及 Skill identity/source/scope/version/verification；
- Candidate claim、diff、case、baseline/candidate 结果；
- whole-Skill 候选谱系、holdout/回归、失败归因、安全扫描、quarantine 与 release tag；
- token、latency、完整 composition cache 指标；
- 飞书连接身份、exact route、入站去重、出站 journal 与 uncertain 状态；
- 当前权限、请求的权限变化和 Protected Action；
- active Generation、parent、canary、rollback target；
- approve、reject、pause、resume、promote、rollback 动作结果。

第一版使用 DSH command/host view 即可。只有至少两个界面 Adapter 需要同一稳定投影时，才抽出公共 Control API。UI 刷新不得新增每轮模型调用、动态 system prompt 或会话内工具变化。

## 4. 可靠性层级

| 层级 | 承诺 | 不承诺 |
|---|---|---|
| P0A Offline Safety | Shadow 不修改 active Skill；评测可重放 | 常驻、晋升、高可用 |
| P0B Local Continuity | 单机重启后恢复 pipeline；无半激活 Generation；幂等外部请求 | 多机故障转移 |
| P1 Bounded Autonomy | future-session canary、窄自动晋升、反事实回滚 | 代码或外部动作自治发布 |
| Future High Availability | 明确 SLO、多个故障域、选主和故障转移 | 在需求与运行数据出现前预建 |

已经发生的消息、日程、付费、部署和数据修改不能通过能力版本回滚撤销，必须继续使用 DSH Protected Action 或领域补偿流程。

## 5. KV Cache 不变量

1. 同一 Session 固定 Capability Generation。
2. 不增加常驻 Evolve system prompt；模型 Tool 只允许少量、显式声明且跨 Session 轮次稳定的任务动作，
   当前为固定 `report_capability_gap`。
3. 工具名、Schema、顺序和 Skill catalog 在 Session 内稳定。
4. 动态状态、审批、时间线和 UI 投影位于 host plane。
5. Skill body 只在原生 Skill 加载路径按需进入后缀。
6. Candidate 只改变被测 artifact；其余完整 composition 必须一致。
7. 晋升只影响未来 Session，并记录 composition fingerprint。
8. 缓存退化是 hard gate；收益不能只用插件局部 token 自证。

## 6. Hermes Replacement Target

“上位”必须按同一任务集验证：

| 能力 | EvoForge 目标 | 当前证据 |
|---|---|---|
| 软件交付 | 原生 Goal 到 verified commit/Draft PR | verified commit、幂等 Draft PR、可选 exact-head checks 门、有界 active-call wait 与原生 Goal 受验证完成 implemented；真实任务数据 pending |
| 单机持续运行 | crash-resume、幂等恢复、无半激活版本 | Generation release + Shadow journal + native Jobs supervisor、`dsh-goal-continuity` Goal 冷恢复与 `dsh-resident` 真实 macOS DSH PID `SIGKILL` 拉起已实现；Linux 真机与生产多日 soak pending |
| Memory/Skill | 复用 DSH/社区能力，不造第二套 Memory | 架构边界已确认 |
| 内部经验自我发现 | 自然语言 Goal 自动使用已安装的适用能力；反复出现真实缺口时从自身经验形成可复核 Opportunity 和完整候选 | 原生目录/路由证据、可证伪 Gap、至少两个独立 Goal 的 Opportunity、四 Goal authoring/admission/holdout 与第五 Goal Retention 预密封、无 Skill 预配置的 Workspace policy、seal-bound Candidate v2、Candidate-independent governance Case Pack authoring/zero-proposer calibration、Envelope v4/v5/Lineage v3、exact-Candidate Shadow/Retention，以及 existing-Skill whole-tree Candidate/结构准入/exact paired Holdout/Retention implemented；V5.12 已补 Workspace-only、无 Skill target 的 exact append-only/effect-clear/model-token-cache non-regression 自动晋升门；两套独立真实 provider、长期迁移与 paired benchmark pending |
| 消息与日程 | 按真实 workflow 提供可拆 Adapter | Telegram、飞书与 Evolve 注意力桥 implemented；真实飞书 App 握手与 setup-only 配对通过，assembled 原生图片入站通过；exact route 用户消息/Hermes paired、普通文件/音视频和内容能力 pending |
| 人类控制 | 状态、证据、审批、暂停、回滚不阻塞会话 | P0C Commands/Web + P3.1 非阻塞 Telegram attention + P3.2 Draft PR review follow-up implemented；语义 capability 审计与陌生用户可用性数据 pending |
| 自进化 | 内部经验发现、独立治理、inactive Candidate、可证明晋升 | Goal-linked Gap → cross-Goal Opportunity → evidence seal → Candidate-independent admission/holdout/Retention Case Pack → exact-Candidate assembled Shadow → durable Retention verdict → review/窄自动门 → content-addressed inactive Generation → future-Session selection → failed-Outcome sealed canary evidence → exact rollback 已形成活动纵切；现有 Skill 的 exact correction 已绑定同一调用时完整 baseline Bundle，并从官方 Feedback/Session 服务在生成前隔离 authoring/admission/holdout/Retention，whole-tree author/Candidate、结构准入、Candidate-blind exact paired Holdout、只从 improved Holdout 触发的 exact Retention 及最终 tarball Web 生命周期已实现；V5.12 的 opt-in 自动门只允许 exact `SKILL.md` 末尾低风险追加并重验 token/cache、pause、parent 与 crash recovery；历史偏差表面已撤销；existing-Skill Canary Host/Jobs、权威 Control/Remote/Web 和独立 expected-active rollback gate 已实现；本增量最终包浏览器、两套独立真实 provider、陌生用户与长期效果 pending |
| 权限 | 代码和外部效果不自动激活 | 需求与测试门已定义 |
| KV Cache | Session 内完整 composition 稳定 | 64 轮 Evolution、GitHub review、Goal Continuity、Software Delivery 固定 surface，以及双 Workspace 双渠道全组合门禁通过；真实 provider cache-read/TTFT soak pending |
| 回滚 | future Session 精确恢复 artifact；外部效果不虚假承诺 | exact parent Git tree 与 live Session 不漂移已实现；外部效果仍不在回滚范围 |

只有这些项目在真实任务、故障注入和成本测量中成立，才可以宣称对应范围优于 Hermes。

具体 paired benchmark、hard gate 和声明等级见 [Hermes 上位目标验收记分卡](hermes-replacement-scorecard.zh.md)。单个能力胜出只能声明对应工作流；Telegram 尚未通过真实 paired benchmark，其他消息或日程范围也尚未交付，因此不作全局“已经上位”声明。

## 7. 仓库策略

GitHub 组织 `deepseek-harness-evoforge` 是所有 DSH 扩展设计与开发的公开归属。默认在 EvoForge Suite 中共仓，避免每个内部阶段一个空仓库。

出现以下任一条件时允许拆仓：

- 独立版本与发布节奏；
- 独立权限、秘密或供应链信任边界；
- 明显不同的运行时、重型依赖或许可证；
- 用户可以不安装 Suite 其余部分而完整采用；
- 独立维护者需要清晰所有权。

首个公开仓库为 `deepseek-harness-evoforge/dsh-evoforge`，首个插件包为 `dsh-evolve`。相关插件默认留在该 Suite；只有 ADR 0005 的拆仓条件成立时才创建新的 `dsh-*` 仓库。

本仓库自己的交付线固定为 `main`：维护 Agent 以小步测试提交持续 push 到 `origin/main`，不新建 feature
或 release branch，不重写已推送历史。运行时 Skill/Candidate/Generation 使用内容寻址存储而不是 Git
branch。只有冻结的核心能力集合通过 clean-profile、全包检查、故障注入、真实浏览器/渠道和 paired
benchmark 门禁后，才在 `main` 创建 annotated semantic tag。该规则不限制 `dsh-software-delivery`
为用户的其他仓库生成 worktree、commit 或 Draft PR。

## 8. 最小路线

1. **统一基线**：保持 `main` 与 `origin/main` 同步，clean checkout 的全包 docs/typecheck/test/build 必须持续绿色。
2. **自主发现**：自然语言 Goal 自动完成 Capability Map 匹配；没有适用能力时产生可复核 Gap，并从跨 Goal 内部经验形成 Opportunity 与 inactive whole-Skill 候选。
3. **双速治理**：把快环 signal/gap/outcome 与慢环归纳/生成/迁移/保留接入现有 Candidate/Trial/Generation；封死 Candidate 到 evaluator/holdout/policy 的写读路径。
4. **可解释控制**：DSH Web 展示能力、缺口、路由、谱系、评测、成本、缓存、安全、回滚和飞书状态，动作复用原生 Approval。
5. **真实集成**：完成 exact 飞书 route 消息/Command/Approval、真实 provider、故障注入、陌生安装与长期 outcome。
6. **上位证据**：按冻结 revision 与 Hermes 进行 discovery、evolution、delivery、continuity、UI、KV、permission、assistant 和 removal paired benchmark。
7. **验证发布**：全部声明范围通过后才创建首个 annotated semantic tag；未通过项继续标为 designed/implemented/pending。

每一阶段未达到可验证退出条件时停止扩张，不用更多插件或基础设施掩盖失败。
