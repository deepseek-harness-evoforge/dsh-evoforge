# EvoForge 插件目录

> 状态：实现与设计目录；只列有独立用户结果的插件，不把内部流水线阶段计为插件

## 已进入路线图

| 插件名 | 用户结果 | 首个阶段 | DSH 复用 | 模型可见面 | 默认仓库 |
|---|---|---|---|---|---|
| `dsh-evolve` | 从自然语言 Goal 与原生 Skill catalog 形成可复核 Capability Map/Gap；仅从 DSH 自身跨 Goal 的失败、纠正、返工、结果、成本、复用、Retention 和回滚证据形成 Skill Opportunity 与隔离 whole-Skill Candidate；再经独立 admission、Shadow、Retention、review、future-Session 晋升和精确回滚闭环 | P0A–P1.21 治理底座和重复 Goal-linked Gap → Opportunity → instruction-only whole-Skill v1 quarantine 已实现；Opportunity v2 已保守关联纠正引用与跨 revision 交付结果；外部获取/runtime research Candidate 和配置式 Skill targets 均已删除；Envelope v2 已以真实 capability-absent baseline 贯穿 admission/assembled Shadow/Review/crash resume；新 Skill 可形成不依赖 Git source 的内容寻址 inactive Generation，并通过真实 DSH future Session/root rollback/restart验证；独立 Retention 与 sealed canary 已对 exact absent parent/whole-Skill/lineage 做无 Git 真实 DSH replay；治理包自主生成、exact invocation、返工/成本/复用/回滚归因、真实 provider、Hermes paired 与长期率待验证 | Skill、Session、Goal、Feedback、Storage、Jobs、Commands、Tools result、FS、Shell、Approval、Token Meter、Web | `report_capability_gap(name)` 只报告 Host 可复核缺口；同 Goal retry、一次成功、模型自评和外部资料均不是自我发现证据；禁止占位 Skill baseline；Candidate inactive/quarantined/unevaluated/never-executed，不能直接 install/activate；只有独立评测后的明确 review 可生成 inactive Generation；author/evaluation policy 都不能预选 Skill；当前 Session 固定；评测治理面与 proposer 隔离；付费不确定结果不盲重试 | `dsh-evoforge` |
| `dsh-software-delivery` | 把原生 Goal 交付为隔离、遵循仓库规范、验证过的 commit 和可选 Draft PR；可选择 exact-head 远端 checks 全绿并在一次 active Tool 调用内有界等待后才完成 | P2A.1 verifier + P2B.1 Goal completion + P2C.1 idempotent Draft PR + P2C.2 checks gate + P2C.3 bounded wait implemented；P2D.1 Evolve consumer 已接通 | Goal、ToolGoal、Skill、Shell、Sandbox、Approval | 一个稳定 Skill catalog entry；正文按需；同一个 ≤2 KiB 稳定 Tool Schema 覆盖可选 PR/checks/wait；host 配置开关不改变模型表面；无 Prompt | `dsh-evoforge`，成熟后可独立采用 |
| `dsh-github-review` | allowlist 人类对当前 Draft PR exact head 请求修改后，将有界、不可信 review 追加到原 Session，继续同一 Goal | P3.2 implemented；真实 DSH follow-up、崩溃去重、有界 Storage、cache parity、tarball 生命周期和公开 GitHub API 已测；真实 reviewer/多日 soak 待验证 | `complete_delivery` Tool result、Agent、Session、Storage Domain、GitHub read-only REST | 0 Tool/Skill/Prompt/System Message；无 review 时 0 模型调用/Session token；actionable 时只在缓存尾部追加一条 bounded user message | `dsh-evoforge` |
| `dsh-doctor` | 一次命令读取当前原生 Loader，把 Runtime Readiness 归约成三态、阻塞插件与下一步；只诊断不修复 | implemented；真实 tarball add/dump/boot/remove 已通过 | Commands、Loader | 一个 human Command；0 Tool/Skill/Prompt；无轮询 | `dsh-evoforge` |
| `dsh-telegram` | 一个静态授权的 Telegram 私聊经 DSH Gateway 持续使用一个原生 Workspace/Session/Agent，并收到所有完成 turn、Command 结果与一次性 Approval | AS-1 + Gateway migration implemented；真实 Workspace/Agent Loop、Storage 重启、429、callback、cache parity、Gateway+Telegram tarball lifecycle、与飞书同 Host 双 Workspace 重启隔离已通过；私有 Delivery Store 已由 Gateway outbound 深模块替换；真实 Bot/Hermes paired 待验证 | DSH Gateway、Agent、Session、Commands、Approval、Storage Domain、Goal/Schedule continuation | 0 Tool/Skill/Prompt；平台轮询、发送映射和 Approval 在 Adapter，入口 identity/Command 与普通文本 outbound 在 Gateway；普通 Session 0 token | `dsh-evoforge` |
| `dsh-evolve-attention` | Candidate 或 Evaluator Draft 需要用户处理时，经既有 exact Telegram/飞书 route 发送一次提醒，原会话继续 | P3.1 Telegram 与飞书扩展 implemented；显式 Workspace、supervisor signal、Gateway durable 去重、不确定发送、cache parity 与 tarball 生命周期已测；真实 Bot/App/移动端/多日 soak 待验证 | Evolve control service、Telegram/飞书 concrete host routes、Gateway outbound journal | 0 Tool/Skill/Prompt/Command；无模型调用、timer、公共 provider SPI 或动态 Session 表面；普通 Session 0 token | `dsh-evoforge` |
| `dsh-goal-continuity` | 进程重启后，exact 静态授权的持久 Session 可自动继续仍 active 的原生 Goal，不必每次人工 `/goal resume` | LC-1 implemented；真实 JSONL 冷恢复、`SIGKILL`、人工恢复 cache surface 等价与 tarball add/boot/remove 已通过；生产多日 soak 待验证 | Agent Session start、Goal、原生 Goal round driver | 0 Tool/Skill/Prompt/Command；只在 cold-resume 边沿 rearm；不扫描 Session、不新增状态库或预算账本 | `dsh-evoforge` |
| `dsh-resident` | 通过 DSH `/resident` 把一个 exact profile 配置为 OS user service，退出或崩溃后自动拉起，并能显式查看和删除 | LC-2 implemented；原生 Bundle/Command、无 bin tarball、macOS 真 `launchd` 启动/`SIGKILL`/新 PID/删除、systemd unit 与 manager 协议已测；Linux 真机 crash 和多日 soak 待验证 | Commands；外部复用 `launchd`/`systemd` | 1 human Command；0 Tool/Skill/Prompt/模型调用；无 daemon 或状态库，普通模型请求不变 | `dsh-evoforge` |
| `dsh-gateway` | 为多个薄渠道 Adapter 提供统一的身份标准化、Workspace/Session 绑定、路由、投递意图、幂等、保守恢复、限流响应和健康接缝 | 已直接替换旧 `dsh-channel-router` 且无转发包；exact route、持久 ingress、Command 一次执行、Telegram/飞书公共 outbound intent/journal、按 account 串行、明确限流重试、uncertain 恢复、脱敏健康、同 Host 双 Workspace 隔离和十一包 clean-profile 已回归通过；transport 聚合、统一 Web 和真实 exact 消息仍待完成 | WorkspaceRegistry、Agent、Session persistence、Agent presets、Commands、Storage Domain | 0 Tool/Skill/Prompt/Command；平台 SDK/凭据/实际发送/卡片 UI 留在 Adapter；Gateway 不拥有 Agent/Session/Goal/Approval 权威，也不声称全局配额或 exactly-once；普通 Session 0 token | `dsh-evoforge` |
| `dsh-feishu` | 一个飞书 App 的 exact 私聊/群聊通过 Gateway 持续使用原生 Workspace/Session/Agent，并接收最终回答、Command、一次性 Approval 与主动通知；首次连接和 routes-mode 健康均位于原生 DSH Web | implemented；官方 SDK WebSocket、真实 DSH Agent Loop、持久 ingress/outbound、429/uncertain、同 Host 双 Workspace 重启隔离、tarball lifecycle 已测；真实 App 身份请求、标准 HTTPS proxy 握手和 setup-only pairing transport 通过；同包 Client Module 从最终 tarball 装入干净 profile，真实浏览器完成配对生成/复制/取消以及 routes-mode 健康读取/刷新/Host 停机失败/同端口恢复，console error 0；真实用户消息闭环待验证 | DSH Gateway、Agent、Session、Commands、Approval、Storage Domain、Goal/Schedule continuation、DSH Client slots/locale/remotes | 0 Tool/Skill/Prompt；正常 Session 只有 scoped `/feishu`，Web 仅在打开/人工刷新时复用它且无写权限；失败刷新清除旧快照；显式 pairing mode 增加一个 human Command、两分钟 listener 和 0 模型调用；配置仍需人工审查后静态生效 | `dsh-evoforge` |

`dsh-evolve` 内部的 Observer、Candidate Lab、Trial Runner、Decision、Release、Monitor 和 Generation Binder 不是独立插件。它们只有组合起来才产生一个用户结果，拆开只会增加配置、版本和缓存理解成本。

`dsh-software-delivery` 对不启用进化的用户仍有完整价值，因此是第二个插件，而不是 `dsh-evolve` 的私有 evaluator。

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
