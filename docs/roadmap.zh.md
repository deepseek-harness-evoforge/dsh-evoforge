# EvoForge v0.1 路线图

> 当前状态：已验证历史统一在 `main` 并同步 `origin/main`；DSH 原生十一包全检查通过。当前自主纵切是自然语言 Goal → Host 复核的 Capability Gap → DSH 内部跨 Goal Skill Opportunity → 隔离 whole-Skill Candidate；运行时外部市场、ClawHub、Agent Skills 索引和 Web 研究已退出自我发现主链路。内部 Candidate 的真实 provider 独立评估、exact 飞书消息与最终 Hermes paired 验收仍未完成，v0.1 尚未发布或部署。
> 更新日期：2026-08-18

## 开发与发布纪律

- 仓库自身只在 `main` 小步 commit，并在每批检查通过后实时 push 到 `origin/main`；不再创建 feature/release branch；
- 运行时 Candidate/Generation 进入 Workspace-scoped 内容寻址存储，不使用 Git branch；
- 普通进度 commit 不打发布 tag；只有冻结的核心集合通过完整门禁，才创建 annotated semantic tag；
- `dsh-software-delivery` 为用户仓库生成 worktree/Draft PR 的能力与上述项目自身纪律相互独立。

## 已有实现

- P0A–P1.21：证据驱动 Shadow、Generation、Session pin、review、Retention、预算、反馈学习、canary 和 rollback；
- P2A.1–P2D.1：原生 Skill/Tool 软件交付、Draft PR、exact-head checks、交付 Outcome；
- P3.1/P3.2：Telegram/飞书进化注意力和 GitHub review follow-up；
- LC-1/LC-2：Goal cold resume 与用户级 OS service unit；
- DSH Web review、Runtime Readiness、Workspace Channel Router、已迁移的 Telegram 与飞书 Adapter。

这些条目表示内部实现和自动化证据存在，不等于当前发布形态已经满足 v0.1。

## V0 — 权威集成基线

- 以最新完整能力为基础合并 ADR-0041 原生插件修正；
- 所有用户包使用 DSH Bundle、Cordis plugin、Skill、Tool、Command 或 Client Module；
- 删除 `dsh-evolve`、`dsh-delivery`、`dsh-resident` 产品 bin；
- DSH/Cordis 只作为 peer + dev dependency；
- 建立覆盖全部包的 clean-profile tarball add/dump/boot/remove/readback gate。

退出门：仓库只有一个权威集成分支和一套真实用户安装路径，原生 DSH 数据在卸载后仍可读取。**十一包统一 clean-profile gate 已完成，已收拢并推送到 `main`。**

## V1 — Workspace Channel Router

- 直接消费 DSH `WorkspaceRegistry`、Agent、Session、Commands、Approval 和 StorageDomain；
- 静态、可审查、默认拒绝地把外部 tenant/chat/thread/user 绑定到既有 Workspace，并通过原生 API 创建或冷恢复稳定 Agent/Session；
- Router ingress 幂等与各 Adapter outbound delivery 状态分别有界持久化；
- Telegram 成为第一个 Adapter；路由核心不复制 DSH Session、Goal、Schedule 或权限。

退出门：两个 Workspace 的输入、输出、Commands、Approval、Goal 和文件权限在重启前后无串线。**已由 Telegram + 飞书同一真实 Host assembled gate 完成。**

## V2 — 飞书 Adapter

实现状态：Adapter、可靠投递、真实 DSH 单 Workspace 组合、双 Workspace 双渠道同 Host 重启隔离、Telegram/飞书进化注意力、tarball lifecycle 与十一包总装已完成；真实飞书 App 身份请求、标准代理环境 WebSocket 和 setup-only pairing transport 已通过。同包 DSH Web Client Module 已从最终 tarball 安装到干净 profile，真实浏览器证明其在当前 Session 内生成/复制/取消配对且零 console error；用户尚未发送配对短语，exact route 消息仍未达到退出门。

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

## V4 — 自主 Skill Discovery 与双速进化

- 用户只提交自然语言 Goal；系统从 Capability Map 自主命中适用、已验证能力，不显示开场选路菜单；
- 无适用能力时产生可复核 Capability Gap；同一 Workspace 内至少两个独立 Goal 的重复缺口才形成 Skill Opportunity；
- Skill 名和候选方向由内部 Goal、失败、纠正、结果、复用与保留证据推导，不由用户或部署者预选 exact Skill；
- Skill 的 identity、source、scope、version、content hash、权限和 verification state 可追踪；
- 候选按 whole-Skill folder 原子版本化，始终 inactive、Workspace-scoped、内容寻址；
- 在线快环只捕获可归因 signal/gap/outcome，离线慢环负责跨 Goal 归纳、候选生成、迁移、保留与遗忘；
- evaluator、holdout、gold、hard gate 和 release eligibility 位于 Candidate 不可读写的治理面；证据不足允许 abstain。

外部生态、论文、Hermes/OpenClaw/HanaAgent 和开源实现用于**设计期调研与冻结 benchmark**，不属于运行时“自我发现”。未来若提供外部 Skill 导入，必须是独立、显式授权的 trusted-import 能力，不能混入自我发现语义。

退出门：在未见 Goal 上自动命中已有 Skill；在确实缺失时找到或生成正确候选；错误路由、未授权获取、
候选越界和负迁移均被 hard gate 拒绝；同一任务 paired baseline 证明首次成功率或人工选路显著改善，且
当前 Session、权限和 cache prefix 不漂移。

实现状态：**partial implementation**。DSH 原生 catalog 负责已有 Skill 的语义选择；固定
`report_capability_gap(name)` Tool 已通过真实 Agent Loop，把 active Goal 中模型确认的无匹配情况经 Host
复核后持久化。`ExperienceDrivenSkillOpportunityDiscovery` 只读取这些 durable Gap：同 Workspace、同一
Skill、至少两个不同 Goal 才产出确定性 Opportunity；同 Goal retry、无 Goal、跨 Workspace 和证据不足均
abstain。`selfDiscoveryPolicies` 只配置 Workspace、run root 和日预算，不接受 Skill、路径、来源、Agent 或
workflow 选择。原生 Job author 只接收有界内部 Goal/Gap 证据，输出 instruction-only whole-Skill v1，Host
校验、内容寻址并写入 inactive/quarantined/unevaluated/never-executed Candidate。DSH Web 展示
Gap → Opportunity → Candidate 及运行状态、成本和治理边界，不显示外部发现尝试。

当前主链路已经删除外部来源配置、Agent Skills 索引配置、运行时 Web research、research Holdout/revision
配置与 Job 编排；这些旧实现只作为历史证据或迁移解析残留，不是产品能力声明。仍待实现/验证：内部
Candidate 的独立 final-test/Shadow/Retention 整链路、真实 provider outcome、模型缺口质量、迁移/遗忘/
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
- 多 Workspace、Skill Discovery、自进化、消息、审批、崩溃恢复和软件交付的 Hermes paired benchmark；
- 真实 provider 的长期 retention/transfer/negative-transfer/false-promotion/false-rollback 与成本数据。

只有证据覆盖的场景可以声明优于 Hermes。所有核心门禁通过后在 `main` 创建首个 annotated semantic
tag；registry release 和生产部署仍需用户另行授权。
