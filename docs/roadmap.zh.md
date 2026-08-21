# EvoForge v0.1 路线图

> 当前状态：已验证提交统一在 `main`；`dsh-gateway` 已替换旧 Router 并完成公共 outbound/健康 Web 的真实浏览器失败恢复验收，飞书图片已在 assembled DSH 中进入 Agent，运行时外部能力获取相关偏差表面已删除。缺失 Skill Candidate 已形成 Retention/Promotion/Canary/Rollback 活动纵切；现有 Skill 已完成完整 baseline、protected whole-tree Candidate、exact Holdout/Retention、独立发布门和最终包浏览器生命周期。V4.46 实现 active existing-Skill release 的 failed-Outcome exact paired Canary Host/Jobs，V4.47 已接入权威 Control/Remote/Web 和独立 expected-active rollback gate。下一阶段从最终 tarball 验证 Canary/rollback 浏览器故障恢复，再做两套独立真实 provider。exact 飞书用户消息与 Hermes paired 仍未完成；普通文件/音视频和飞书内容能力仍 pending，v0.1 未发布。
> V4.38 已在 existing-Skill Candidate proposer 前生成并校准 Candidate 不可见的完整 `skill-tree` holdout Envelope；V4.39 已把 exact Envelope 纳入 Candidate 内容身份并消费该 Envelope 与 V4.37 exact 双树执行 assembled paired Trial。下一门是独立 Retention/Canary/晋升/回滚，而不是再次生成或搜索能力。
> V4.40–V4.45 已完成 Retention、发布门与最终包浏览器生命周期；V4.46–V4.47 已完成 existing-Skill failed-Outcome Canary、权威 Control/Remote/Web 与独立 expected-active rollback gate。下一门是最终 tarball 浏览器故障恢复。
> 更新日期：2026-08-21

## 开发与发布纪律

- 仓库自身只在 `main` 小步 commit，并在每批检查通过后实时 push 到 `origin/main`；不再创建 feature/release branch；
- 运行时 Candidate/Generation 进入 Workspace-scoped 内容寻址存储，不使用 Git branch；
- 普通进度 commit 不打发布 tag；只有冻结的核心集合通过完整门禁，才创建 annotated semantic tag；
- `dsh-software-delivery` 为用户仓库生成 worktree/Draft PR 的能力与上述项目自身纪律相互独立。

## 已有实现

- 当前活动 Evolution：内部 Gap/Opportunity/Candidate、独立治理、exact-Candidate Shadow/Retention、future-Session Promotion Eligibility、failed-Outcome sealed canary evidence、Generation、Session pin、review 和 rollback；历史 P1 静态 target/Draft/Retention/canary 编排已撤销，新的 canary 只从内部 exact evidence 重建且无发布权；
- P2A.1–P2D.1：原生 Skill/Tool 软件交付、Draft PR、exact-head checks、交付 Outcome；
- P3.1/P3.2：Telegram/飞书进化注意力和 GitHub review follow-up；
- LC-1/LC-2：Goal cold resume 与用户级 OS service unit；
- DSH Web review、Runtime Readiness、Workspace DSH Gateway、已迁移的 Telegram 与飞书 Adapter。

这些条目表示内部实现和自动化证据存在，不等于当前发布形态已经满足 v0.1。

## V0 — 权威集成基线

- 以最新完整能力为基础合并 ADR-0041 原生插件修正；
- 所有用户包使用 DSH Bundle、Cordis plugin、Skill、Tool、Command 或 Client Module；
- 删除 `dsh-evolve`、`dsh-delivery`、`dsh-resident` 产品 bin；
- DSH/Cordis 只作为 peer + dev dependency；
- 建立覆盖全部包的 clean-profile tarball add/dump/boot/remove/readback gate。

退出门：仓库只有一个权威集成分支和一套真实用户安装路径，原生 DSH 数据在卸载后仍可读取。**十一包统一 clean-profile gate 已完成，已收拢并推送到 `main`。**

## V1 — Workspace DSH Gateway

- 直接消费 DSH `WorkspaceRegistry`、Agent、Session、Commands、Approval 和 StorageDomain；
- 静态、可审查、默认拒绝地把外部 tenant/chat/thread/user 绑定到既有 Workspace，并通过原生 API 创建或冷恢复稳定 Agent/Session；
- Gateway 统一有界持久化 ingress 与普通文本 outbound delivery；Adapter 只保留平台协议、实际发送与平台特有 UI；
- Telegram 成为第一个 Adapter；路由核心不复制 DSH Session、Goal、Schedule 或权限。

退出门：两个 Workspace 的输入、输出、Commands、Approval、Goal 和文件权限在重启前后无串线。**现有 ingress/route 内核已由 Telegram + 飞书同一真实 Host assembled gate 完成；公共 outbound intent/journal、幂等、按 account 串行、明确 rate-limit 有界重试、turn/end 门、uncertain 恢复和脱敏健康已进入 Gateway，两个 Adapter 的重复 Delivery Store/worker 已删除。Gateway 已校验并聚合 Telegram long-poll 与飞书 WebSocket 的 exact-route transport observation，覆盖 degraded→ready 恢复；同包统一 Gateway Web 已从最终 tarball 在真实 DSH 浏览器验证读取、刷新、Host 停机清空旧快照和同端口恢复。**

## V2 — 飞书 Adapter

实现状态：Adapter、Gateway 公共可靠投递、真实 DSH 单 Workspace 组合、双 Workspace 双渠道同 Host 重启隔离、Telegram/飞书进化注意力、tarball lifecycle 与十一包总装已完成；真实飞书 App 身份请求、标准代理环境 WebSocket 和 setup-only pairing transport 已通过。assembled 图片纵切已经证明外部 key 只停留在 Adapter，原生引用进入 Session 且 exact bytes 可由 AttachmentStore 回读；它不是用户真实飞书消息或真实多模态 provider 证据。同包 DSH Web Client Module 已从最终 tarball 安装到干净 profile，真实浏览器证明其在当前 Session 内生成/复制/取消配对且零 console error；用户尚未发送配对短语，exact route 消息仍未达到退出门。普通文件、音视频及飞书内容能力继续作为独立权限增量，不发明 Gateway file block。

- 支持静态授权的私聊或群聊文本、原生 Command、一次性 Approval、最终回答、Goal/Schedule 与进化注意力；
- 凭据、身份与 Workspace route 只能由部署配置决定；
- 事件去重、限流、结果不确定状态和 Cordis dispose 完整；
- Telegram 与飞书共同证明公共渠道接缝，不预建更多平台功能。

退出门：fake API/协议测试、真实 DSH 双 Workspace assembled 测试，以及 exact 飞书 chat/user 下的入站、回复、Command 与 Approval 冒烟。本轮按项目所有者要求不验证 Telegram。

## V3 — Workspace-scoped Evolution

- Candidate、Case Pack、Generation、反馈、预算、review 和 rollback 都有 Workspace 归属；
- 当前 Session 固定 Generation，晋升只影响同 Workspace 的未来 Session；
- 跨 Workspace 引用和状态损坏 fail closed；
- 保留现有 evaluator、Retention、Protected Action、成本和 Cache Contract。

退出门：Workspace A 完成纠正、Candidate、评测、晋升和 future-session 生效时，Workspace B 与 A 的旧 Session 均不变化。

实现状态：上述链路已由固定 DSH 源码的真实 Host 双 Workspace assembled test 完成，并覆盖重启持久化；真实 provider outcome 仍属于 V4。

## V4 — 内部经验自我发现与双速进化

- 用户只提交自然语言 Goal；系统从 Capability Map 自主命中适用、已验证能力，不显示开场选路菜单；
- 无适用能力时产生可复核 Capability Gap；同一 Workspace 内至少两个独立 Goal 的重复缺口才形成 Skill Opportunity；
- Opportunity 达到至少四个独立 Goal 后，先由治理面密封 authoring/admission/holdout；存在第五个或更多独立 Goal 时再保留一个 Candidate 不可见的 Retention 样本。作者看不到任何 protected 组，样本不足不花预算或生成 Candidate；
- 现有已安装 Skill 的改进先绑定调用时完整 Bundle，再从官方 Feedback/Session 服务密封真实纠正；至少四个不同 Goal 后才隔离 authoring/admission/holdout，第五个及以上保留 Retention。当前已完成该证据门，下一步是 whole-tree author 与 paired evaluation；
- Skill 名和候选方向由内部 Goal、失败、纠正、结果、复用与保留证据推导，不由用户或部署者预选 exact Skill；
- Skill 的 identity、source、scope、version、content hash、权限和 verification state 可追踪；
- 候选按 whole-Skill folder 原子版本化，始终 inactive、Workspace-scoped、内容寻址；
- 在线快环只捕获可归因 signal/gap/outcome，离线慢环负责跨 Goal 归纳、候选生成、迁移、保留与遗忘；
- evaluator、holdout、gold、hard gate 和 release eligibility 位于 Candidate 不可读写的治理面；证据不足允许 abstain。

外部生态、论文、Hermes/OpenClaw/HanaAgent 和开源实现只用于**设计期调研与冻结 benchmark**。本项目不建设运行时外部 Skill 搜索、下载、导入、市场或“能力获取”功能。

退出门：在未见 Goal 上自动命中已有 Skill；在确实缺失时找到或生成正确候选；错误路由、未授权获取、
候选越界和负迁移均被 hard gate 拒绝；同一任务 paired baseline 证明首次成功率或人工选路显著改善，且
当前 Session、权限和 cache prefix 不漂移。

实现状态：**partial implementation**。DSH 原生 catalog 负责已有 Skill 的语义选择；固定
`report_capability_gap(name)` Tool 已通过真实 Agent Loop，把 active Goal 中模型确认的无匹配情况经 Host
复核后持久化。`ExperienceDrivenSkillOpportunityDiscovery` 以 durable Gap 决定资格：同 Workspace、同一
Skill、至少两个不同 Goal 才产出确定性 Opportunity；同 Goal retry、无 Goal、跨 Workspace 和证据不足均
abstain。Opportunity v3 只关联 feedback 目标回答同一 durable turn 中唯一成功 Skill 调用及其 exact Goal id/revision，
并保存模型当时实际看到的 invocation content hash，不再按同 Session Gap 或同名 Skill 猜测；同时按 stable Goal identity 跨 revision 的唯一 Gap Skill 关联 compact delivery outcome。Outcome
必须晚于对应 Gap、revision 不得倒退、歧义 fail closed；两类上下文固定 `causalClaim: none`，且不
改变资格/排序或 author 输入。`selfDiscoveryPolicies` 只配置 Workspace、run root 和日预算，不接受 Skill、路径、来源、Agent 或
workflow 选择。原生 Job author 只接收有界内部 Goal/Gap 证据，输出 instruction-only whole-Skill v1，Host
校验、内容寻址并写入 inactive/quarantined/unevaluated/never-executed Candidate。DSH Web 展示
Gap → Opportunity → Candidate 及运行状态、成本和治理边界，不显示外部发现尝试。

Existing-Skill improvement 与 missing-Skill Opportunity 分轨。V4.33–V4.45 已完成完整 baseline、protected Candidate、Candidate-blind exact Holdout/Retention、独立发布门与最终 tarball 生命周期。V4.46 只在 active Generation 精确对应 approved existing-Skill release 时消费失败 Outcome，重验专用 lineage并通过 Retention owner 物化 exact baseline/Candidate/Case Pack；原生 Jobs paired replay 只有在 baseline pass、Candidate fail 时给出无 mutation 权的 rollback-eligible，双失败进入 review，paid-uncertain 不重试。V4.47 已用独立 Host owner 重验 exact Canary，并经 expected-active compare 只回滚未来 Session；Control/Remote/Web 共用该门。下一步以最终 tarball 和两套独立真实 provider 跑出故障恢复与效果证据。

V4.40 将第五 Goal 密封为独立 Retention Case Pack；V4.41–V4.45 已完成 exact Retention、future-Session 发布门及最终包浏览器；V4.46–V4.47 已完成 failed-Outcome Canary、权威 Control/Remote/Web 和独立 Host expected-active rollback gate。下一纵切从最终 tarball 验证实际 rollback、Session 固定、断连恢复和卸载。

内部 Candidate 评测已删除 `candidateAdmissionTargets`/`candidateShadowTargets` 这两套预选 exact Skill 的配置。
`candidateEvaluationPolicies` 不声明 Skill、baseline、Case Pack 或 Candidate 方向；自主治理只增加 exact DSH revision 和独立日预算。Host 先从 exact Opportunity
自动形成内容寻址的 `Skill Evaluation Evidence Seal`，Candidate v2 将 seal id 纳入内容身份；Candidate-independent 治理模块分别用受保护 admission/holdout，以及可用时的第五 Goal Retention 样本形成互不复用的 Case Pack，同 proposer model identity 在预算前 fail closed，并以零 proposer 调用校准；四 Goal Envelope v4 或带 Retention 的 Envelope v5 再绑定 seal、author-input digest、治理作者/输入 digest、
exact Opportunity 快照和禁止占位 Skill 的 capability-absent
baseline、deterministic admission 和不同的 assembled holdout。真实 assembled DSH baseline 不安装目标 Skill，
Candidate 侧才安装 exact whole-Skill；Envelope id 和 seal id 贯穿 admission、Candidate Lineage v3、Shadow 与 crash resume；
内容漂移、symlink、根重叠和任意 protected Case Pack 同 hash 都 fail closed，缺包则 abstain。新 Skill Publisher
已不再假设既有 Git source：explicit review 后生成 canonical `skill-bundle` inactive Generation，Storage/Provider
重验 exact 内容，真实 DSH Session 证明 future-only、root rollback 和重启恢复。Shadow 只执行 exact Candidate/lineage 与真实 assembled DSH composition，自身不调用 proposer；旧 capability-absent Retention/sealed-canary 编排已删除。V4.25 已用内部第五 Goal 重建独立 assembled Retention Case Pack、Envelope v5、Host/Remote 与 Web 治理投影；V4.26 已将该分区接到同一 Shadow Jobs 任务，重验 durable Shadow/Lineage/subject/tree/hash/revision/budget/composition，并以零 proposer 调用内容寻址落盘 retained/regressed/incomplete；V4.27 已由各自权威 reader 扫描 Shadow/Retention，按 exact lineage/tree 拼接并在 DSH Web 显示 verdict、reason、trial、composition、model/token/cache 和无发布权，错配只告警；V4.28 已从最终 tarball 安装到隔离 profile，以真实 DSH 浏览器验证整页 reload、Host 停机失败、最后成功证据保留和同端口恢复；V4.29 已由独立 Host gate 把 exact retained 证据转换为 future-Session eligibility，missing/prepared 等待，warning/错配/回归/incomplete 阻断，并从最终 tarball在真实 DSH Web 验证 eligible/enabled、regressed/disabled、Host 失败保留证据、同端口恢复和卸载；V4.31 已让失败 Outcome 触发新的内容寻址 Canary Job，重验同一谱系并只生成 keep/review/rollback-eligible 证据；V4.32 已让唯一 Rollback Gate 重验 exact Canary/Workspace/active Generation，并以 Store 临界区 expected-active compare 防止并发误回滚。治理包自动形成、原子安装和 paid-call uncertain restart 已通过注入式自动化测试。下一步补 Canary/rollback 真实环境与长期 outcome，并用两套独立真实 provider 跑全链。

当前活动源码已经删除外部来源发现、Agent Skills 索引/archive、运行时 Web research、research Holdout/revision
及其 Job 编排、依赖、持久化变体和 Web 类型；Candidate Repository、Admission、Lineage、Shadow 只接受
内部 Skill Opportunity 与 canonical text bundle，不读取旧字段或提供兼容入口。历史证据页仅用于解释已撤销决策。
已补齐一层非因果 cost fact：Delivery Outcome 可保存 exact Goal-owned turn 的官方 provider usage、
cache-read/write 和 latency projection，货币成本明确 unavailable，且不影响资格/author。Host 权威 summary、
generated Remote 与 DSH Web 已展示 Workspace/current/baseline 聚合和至多 20 条最近已测 Outcome；真实浏览器已验证
在线刷新、Host 断连保留最后快照并显式报错、同 profile 重启恢复和幂等重放。失败 Outcome 现可触发 exact active internal Candidate 的内容寻址 sealed canary；自动化测试覆盖 keep/review/rollback-eligible、预算、输入与 pointer 漂移、中断不盲重试、持续监测和 DSH Jobs。仍待实现/验证：
existing-Skill Canary/rollback 的最终包恢复、correction/outcome 的因果证明，以及 rework/currency-cost/reuse/retention/negative-transfer/rollback 的完整归因、内部 Candidate 治理包的两套独立真实 provider outcome、模型缺口质量、迁移/遗忘/
长期保留，以及同条件 Hermes paired outcome。因此不能描述为“自主 Skill 进化已完成”。

## V5 — 可解释 Web 与飞书闭环

- DSH Web 展示 Capability Map、Gap queue、实际路由、Skill 来源/scope/version/utility；
- 展示 whole-Skill 候选谱系/diff、baseline/candidate/holdout、失败归因、成本/时延/cache、安全、quarantine、promotion/rollback 和 Generation/tag；
- 展示飞书 App/account/exact route、连接健康、去重、出站 journal、429 与 uncertain；
- 所有状态来自 DSH Host 权威投影，关键动作复用原生 Command/Approval；
- 完成 exact 飞书 chat/user 的入站、回复、Command、Approval 和进化 attention 闭环。

退出门：最终 tarball 在全新 profile 的真实浏览器与真实飞书 App 上覆盖成功、刷新、权限拒绝、身份错误、
429、网络不确定、重启、dispose 和卸载路径；UI 不新增 Session 模型工具/Prompt/token。

实现状态：既有 Evolve review、Capability Map/Gap、内部 Skill Opportunity、隔离 whole-Skill Candidate、admission/Shadow、飞书配对 UI、
routes-mode 脱敏健康投影和渠道底座已实现；健康面最终 tarball 的真实浏览器读取/刷新/Host 停机与恢复
已通过，完整评测演进视图与真实飞书 exact route 消息 **pending**。

## V6 — v0.1 验收与首个 tag

- 全包 tarball clean-profile 安装、dump、boot、真实 Agent/Session/Goal、卸载与 readback；**已完成**
- dependency loss、reload、dispose、崩溃、重复事件、429、网络不确定和身份拒绝；
- 完整 composition cache parity；**已完成，见 `pnpm test:cache-contract`**
- DSH Web 真实浏览器成功、刷新和失败路径；
- 多 Workspace、自我发现、自进化、Gateway、消息、审批、崩溃恢复和软件交付的 Hermes paired benchmark；
- 真实 provider 的长期 retention/transfer/negative-transfer/false-promotion/false-rollback 与成本数据。

只有证据覆盖的场景可以声明优于 Hermes。所有核心门禁通过后在 `main` 创建首个 annotated semantic
tag；registry release 和生产部署仍需用户另行授权。
