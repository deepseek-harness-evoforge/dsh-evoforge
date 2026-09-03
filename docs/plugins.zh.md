# EvoForge 插件目录

> 状态：实现与设计目录；只列有独立用户结果的插件，不把内部流水线阶段计为插件

## 先看用户能力，而不是十二个内部包

用户默认安装入口已经精简为 `core`、`channels`、`delivery`、`continuity` 四个能力套件；`attention` 是可选附加能力，`evolution`、`control`、`gateway` 只为旧脚本保留，`full` 仅供维护者验收。`channels` 自带轻量原生 Control Center，保证渠道用户只开一个 DSH Web 页面即可完成配对和健康查看。每个套件仍展开为真实 DSH Bundle，保留独立启停、卸载、权限和升级边界。请先看[能力套件与内部插件边界](capability-suites.zh.md)。下表是维护者需要审计的内部包目录，不是要求用户逐个选择的启动问卷。

## 已进入路线图

| 插件名 | 用户结果 | 首个阶段 | DSH 复用 | 模型可见面 | 默认仓库 |
|---|---|---|---|---|---|
| `dsh-evolve` | 从自然语言 Goal 与原生 Skill catalog 形成可复核 Capability Map/Gap；仅从 DSH 自身跨 Goal 的失败、纠正、返工、结果、成本与复用证据形成 Skill Opportunity、existing-Skill improvement investigation 与隔离 whole-Skill Candidate；再经独立 admission、exact-Candidate Shadow、Retention、review、future-Session 晋升和精确回滚闭环 | 重复 Goal-linked Gap → Opportunity → instruction-only whole-Skill v1 quarantine 已实现；Opportunity v3 只从目标回答的唯一 durable Skill invocation/exact Goal 关联纠正，同版本跨 Goal 纠正逐一重验 immutable Session/invocation reference，只有全部指向同一调用时完整 baseline Bundle 才获得无发布权资格；至少四个不同 Goal 后再经官方 Feedback/Session 服务把当前纠正文与 durable Goal/请求预分为 authoring/admission/holdout，第五个及以上保留 Retention，proposer 与 Web 不见保护正文；Delivery Outcome 仍按 stable Goal 非因果关联；V4.50–V4.52 已投影 exact 跨 Goal 复用、后续 Outcome 与尝试间工作，V4.53 又把两个不同 Goal 的唯一 latest failed 形成可撤回、无 Candidate/发布权的 review-only 调查；外部获取、配置式 targets、活动 Git source/ref、Feedback/Evaluator Draft、Shadow 内 proposer、自动 review expiry 与旧 Retention/canary 编排均已删除；Candidate v2/Lineage v3 绑定 evidence seal，Candidate-independent 治理作者分别只见 admission/holdout/可选第五 Goal Retention；Shadow 只消费 exact DSH-assembled Candidate，promotable 结果在同一 Jobs 任务进入内容寻址 Retention paired Trial，均为零 proposer；新 Skill 可形成内容寻址 inactive Generation，并通过 future Session/root rollback/restart 验证；独立 Host gate 只允许 exact retained Candidate 晋升未来 Session，Web 已验证 eligible/blocked/失败恢复；失败 Outcome 另经原生 DSH Jobs 触发 exact sealed Canary，只产出 keep/review/rollback-eligible 且自身无 pointer 权限；独立 rollback gate 重验 exact Canary 并以 expected-active compare 执行人工确认的 future-Session 回滚，Control/Remote/Web 无直接 Store 旁路；现有 Skill whole-tree author/Candidate/结构准入/Candidate-blind exact paired Holdout/Retention 已实现，Holdout 与 Retention 均完成最终 tarball 浏览器故障恢复与卸载；V4.43–V4.45 完成独立 existing-Skill lineage、持久人工决定、inactive Generation、分步 future-Session selection 及最终 tarball 生命周期；V4.46 实现 active release failed-Outcome exact paired Canary、原生 Jobs 与 paid-uncertain 恢复；V4.47 已接入 bounded Control、固定 Typert Remote、确认式 Web 与独立 expected-active rollback gate；V4.48 已从最终 tarball 验证 existing-Skill approve/promote/Canary/断连保留/精确 rollback/冷恢复/卸载；V4.49 已验证 missing-Skill `skill-bundle` 的 promote/Canary/断连保留/精确 root rollback/冷恢复/卸载；两套独立真实 provider、完整 outcome 归因、Hermes paired 与长期率待验证 | Skill、Session、Goal、Feedback、Storage、Jobs、Commands、Tools result、FS、Shell、Approval、Token Meter、Web | `report_capability_gap(name)` 只报告 Host 可复核缺口；同 Goal retry、一次成功、模型自评和外部资料均不是自我发现证据；禁止占位 baseline；Candidate/holdout/Retention/Canary verdict 无安装/激活/发布权；用户不选路径；author、治理、执行和 mutation 面隔离；当前 Session固定；付费不确定结果不盲重试 | `dsh-evoforge` |
| `dsh-software-delivery` | 把原生 Goal 交付为隔离、遵循仓库规范、验证过的 commit 和可选 Draft PR；可选择 exact-head 远端 checks 全绿并在一次 active Tool 调用内有界等待后才完成 | P2A.1 verifier + P2B.1 Goal completion + P2C.1 idempotent Draft PR + P2C.2 checks gate + P2C.3 bounded wait implemented；P2D.1 Evolve consumer 已接通 | Goal、ToolGoal、Skill、Shell、Sandbox、Approval | 一个稳定 Skill catalog entry；正文按需；同一个 ≤2 KiB 稳定 Tool Schema 覆盖可选 PR/checks/wait；host 配置开关不改变模型表面；无 Prompt | `dsh-evoforge`，成熟后可独立采用 |
| `dsh-github-review` | allowlist 人类对当前 Draft PR exact head 请求修改后，将有界、不可信 review 追加到原 Session，继续同一 Goal | P3.2 implemented；真实 DSH follow-up、崩溃去重、有界 Storage、cache parity、tarball 生命周期和公开 GitHub API 已测；真实 reviewer/多日 soak 待验证 | `complete_delivery` Tool result、Agent、Session、Storage Domain、GitHub read-only REST | 0 Tool/Skill/Prompt/System Message；无 review 时 0 模型调用/Session token；actionable 时只在缓存尾部追加一条 bounded user message | `dsh-evoforge` |
| `dsh-doctor` | 一次命令读取当前原生 Loader 与现有 Gateway 脱敏 transport health，把插件及必需飞书/Telegram 连接就绪归约成三态、阻塞项与下一步；只诊断不修复 | implemented；最终 tarball add/dump/boot 中准确观察 degraded，经 Cordis reload 观察 ready，remove 清理已通过；损坏快照 fail closed；新增公共 Control Center 只读 Surface，浏览器门待补 | Commands、Loader、可选 DSH Gateway 只读服务、DSH API Remotes、Control Center Surface | 一个 human Command + 一个只读 Web Surface；0 Tool/Skill/Prompt；无平台调用、凭据读取、轮询、健康副本或自动修复 | `dsh-evoforge` |
| `dsh-telegram` | 一个静态授权的 Telegram 私聊经 DSH Gateway 持续使用一个原生 Workspace/Session/Agent，并收到所有完成 turn、Command 结果与一次性 Approval；Web 控制台显示该 Adapter 的固定路由和持久投递 | AS-1 + Gateway migration implemented；真实 Workspace/Agent Loop、Storage 重启、429、callback、cache parity、Gateway+Telegram tarball lifecycle、与飞书同 Host 双 Workspace 重启隔离、实际 tarball 的 loopback Surface 浏览器刷新/reload 已通过；私有 Delivery Store 已由 Gateway outbound 深模块替换；真实 Bot/Hermes paired 与外部 route 浏览器门待验证 | DSH Gateway、Agent、Session、Commands、Approval、Storage Domain、Goal/Schedule continuation、DSH API Remotes、Control Center Surface | 0 Tool/Skill/Prompt；一个只读 Web Surface；平台轮询、发送映射和 Approval 在 Adapter，入口 identity/Command 与普通文本 outbound 在 Gateway；普通 Session 0 token | `dsh-evoforge` |
| `dsh-evolve-attention` | Candidate review 或 inactive promotion decision 需要用户处理时，经既有 exact Telegram/飞书 route 发送一次提醒，原会话继续 | P3.1 Telegram 与飞书扩展 implemented；Evaluator Draft 投影已删除；显式 Workspace、supervisor signal、Gateway durable 去重、不确定发送、cache parity 与 tarball 生命周期已测；真实 Bot/App/移动端/多日 soak 待验证 | Evolve control service、Telegram/飞书 concrete host routes、Gateway outbound journal | 0 Tool/Skill/Prompt/Command；无模型调用、timer、公共 provider SPI 或动态 Session 表面；普通 Session 0 token | `dsh-evoforge` |
| `dsh-goal-continuity` | 进程重启后，exact 静态授权的持久 Session 可自动继续仍 active 的原生 Goal，不必每次人工 `/goal resume` | LC-1 implemented；真实 JSONL 冷恢复、`SIGKILL`、人工恢复 cache surface 等价与 tarball add/boot/remove 已通过；生产多日 soak 待验证 | Agent Session start、Goal、原生 Goal round driver | 0 Tool/Skill/Prompt/Command；只在 cold-resume 边沿 rearm；不扫描 Session、不新增状态库或预算账本 | `dsh-evoforge` |
| `dsh-resident` | 通过 DSH `/resident` 把一个 exact profile 配置为 OS user service，退出或崩溃后自动拉起，并能显式查看和删除 | LC-2 implemented；原生 Bundle/Command、无 bin tarball、macOS 真 `launchd` 启动/`SIGKILL`/新 PID/删除、systemd unit 与 manager 协议已测；Linux 真机 crash 和多日 soak 待验证 | Commands；外部复用 `launchd`/`systemd` | 1 human Command；0 Tool/Skill/Prompt/模型调用；无 daemon 或状态库，普通模型请求不变 | `dsh-evoforge` |
| `dsh-gateway` | 为薄渠道 Adapter 提供常驻身份授权、Host 配对、Workspace/Session 绑定、文本/原生图片入站、路由、投递幂等、保守恢复、限流响应和 DSH Web 控制面 | exact route、持久 ingress/outbound、动态 trust grant、hashed pending code、脱敏 pending request 列表与 request-id/code 双审批、Workspace/live Session/cwd gate、resident零-route transport 健康、同 Host 双 Workspace隔离已回归；最终 tarball 在真实 rc.2 Web 完成真实飞书 DM→code→Host approve→三次 native Session/回复，journal 3/3 且零异常；Host 冷启动恢复 exact grant/Session/journal/transport，无重复投递 | WorkspaceRegistry、Agent、Session persistence、Agent presets、Commands、AttachmentStore、Storage Domain、DSH Typert Remote/Client slots/locale | 0 Tool/Skill/Prompt/Command；Web `overview()`/`pendingPairings()` 不调用模型，`approvePairing()`/`approvePairingRequest()` 只把外部 principal 绑定到已选 native Session；平台 SDK/凭据/发送/重连/卡片留在 Adapter；不拥有 Agent/Session/Goal/Approval 权威，不发明通用 file block | `dsh-evoforge` |
| `dsh-feishu` | 一个飞书 App 通过 resident Gateway 把 exact 私聊持续接入原生 Workspace/Session/Agent，并接收最终回答、Command、一次性 Approval 与主动通知 | implemented；Bundle boot 官方 WebSocket、未知 DM code、Host approval/两步撤销、动态 route、持久 ingress/outbound、429/uncertain、图片、双 Workspace、tarball lifecycle assembled 已测；旧 `/feishu-pair`/两分钟 listener/反向短语/UI 已删除；真实 App 已完成普通文本、原生 `/new`、普通文本三次入站/回复及 Host 重启恢复；动态 paired route 已进入 Host notice seam，assembled Approval `allowed-once`/notice 通过；真实撤销重配、Approval/Schedule/group/failure/long-soak 与内容权限 pending；rc.2 无通用文件/音视频契约 | DSH Gateway、AttachmentStore、Agent、Session、Commands、Approval、Storage Domain、Goal/Schedule continuation、DSH Client slots/locale/remotes | 0 Skill/Prompt；首条未知 DM 不进 Agent；普通 Session 只有 scoped `/feishu` 健康 Command；内容 Tool 仅按独立静态权限启用；外部 `fileKey` 只在 Adapter 下载边界存在 | `dsh-evoforge` |

`dsh-evolve` 内部的 Observer、Candidate Lab、Trial Runner、Decision、Release、Monitor 和 Generation Binder 不是独立插件。它们只有组合起来才产生一个用户结果，拆开只会增加配置、版本和缓存理解成本。

`dsh-software-delivery` 对不启用进化的用户仍有完整价值，因此是第二个插件，而不是 `dsh-evolve` 的私有 evaluator。

V4.40–V4.49 只深化现有 `dsh-evolve`/`dsh-evolve-web`，不新增插件：existing-Skill 第五 Goal 形成独立 Retention Case Pack，V4.43–V4.45 完成独立发布门及最终包生命周期；V4.46 的 failed-Outcome Canary 仍在同一插件内由原生 Jobs 重放 exact retained pair，只产出无 mutation 权的证据；V4.47 的 rollback writer 是与 evaluator 分权的 Host gate，并通过同一 Control/Remote/Web 人工确认；V4.48 从最终包验证 existing-Skill 完整动作、故障、恢复与卸载，V4.49 对 missing-Skill `skill-bundle` 完成同类最终包验证。Canary、晋升、回滚属于同一个 `dsh-evolve` 闭环，不拆成新插件、第二 Runtime 或第二审批体系。

V5.12 同样只深化 `dsh-evolve`/`dsh-evolve-web`：Workspace-only `automaticPromotionPolicies` 不能指定 Skill、路径、来源、Candidate 或评测 target；existing-Skill release owner 只对 exact append-only/effect-clear/non-regressing 指令 Candidate 自动发布并选择未来 Session。原生 Jobs 是薄唤醒 Adapter，Control/Web 是只读权威投影，没有新增插件、Gateway、Runtime、Store 或审批体系。

## 尚未进入路线图的候选

| 候选 | 进入条件 | 为什么现在不建 |
|---|---|---|
| `Control Center` | 至少 `Evolve` 与另一个插件需要同一状态投影，并且 CLI/Web 两个 Adapter 已证明公共契约 | P0C 先由 `Evolve` 自己提供 command/view，避免预建 UI 平台 |
| 第三个 Assistant Adapter | 在 Telegram 与飞书之外出现独立高频需求、明确权限边界和可验证 outcome，并能复用现有 Gateway 接缝 | 两个 Adapter 已足够验证当前变化点；不为“主流平台列表”预建空壳 |
| 独立 Optimizer Adapter | 简单 patch proposer 无法覆盖 P0A，且 GEPA 或其他优化器在相同 evaluator 上产生净收益 | 候选搜索不是产品护城河；首版不发布抽象接口 |

## 明确不创建

- Cache 插件：Cache Contract 是所有插件的硬约束。
- Mission、Work Item DAG 或通用 Supervisor：继续使用 DSH Goal。
- 第二套 Memory、Session、Approval、Policy、Event Store 或 Agent Runtime。
- Observer、Promoter、Rollback、Evaluator 等单步骤浅插件。
- 以修复 DSH Core Defect 为主要价值的兼容插件。

## 拆仓规则

插件默认放在 Suite。只有独立发布/维护周期、独立信任边界、明显不同的重型依赖或许可证、或者无需 Suite 其余能力即可完整采用时才拆仓；详见 [ADR 0005](adr/0005-evoforge-repository-boundaries.md)。

首个 GitHub 仓库名与当前包名已经冻结为 `dsh-evoforge`、`dsh-evolve`、
`dsh-evolve-web`、`dsh-software-delivery`、`dsh-github-review`、`dsh-doctor`、`dsh-telegram`、`dsh-evolve-attention`、
`dsh-goal-continuity`、`dsh-resident`、`dsh-gateway` 和 `dsh-feishu`。可发布包的本地
打包安装/卸载边界已验证；npm 尚未发布，发布前仍需版本策略、第三方安装验收与发布授权。
