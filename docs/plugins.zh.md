# EvoForge 插件目录

> 状态：实现与设计目录；只列有独立用户结果的插件，不把内部流水线阶段计为插件

## 已进入路线图

| 插件名 | 用户结果 | 首个阶段 | DSH 复用 | 模型可见面 | 默认仓库 |
|---|---|---|---|---|---|
| `dsh-evolve` | 从真实任务结果和明确反馈产生可调查证据、私有 Case Draft 与受审查 Evaluator Draft，用静态 Target 显式或按部署策略生成 inactive evaluator/启动 Shadow、允许人工一次确认 qualification 与成功后的 Shadow、用持久日预算、每 Skill 单未决门和模糊审查有界处置限制自动付费尝试，并把 exact 审阅窗口与 active/parent outcome 观察计数投影给 Commands/Web；在付费前校准并独立评测 inactive Skill Candidate，再用独立历史 Case Pack 检查 exact Candidate 是否遗忘旧能力，以人工或最窄 opt-in policy 为未来 Session 晋升/回滚 | P0A + P0B + P0C + P1.1–P1.21 + P2D.1 implemented；真实 provider/用户纠正与真实任务长期率待验证 | Skill、Session、Goal、Feedback、Storage、Jobs、Commands、Tools result、FS、Shell、Approval、Token Meter | 无新增 Evolve Tool/Prompt；active Generation 复用原生 Skill catalog/body并按 Session 固定；outcome/compare/feedback/canary/draft/calibrate/review/launch/retain/budget/inflight/expiry/window 只在 host plane；草稿只在逐次动作或 static automatic Target policy 后进入 author/proposer；outcome 对照固定非因果且不触发 release；generated evaluator 始终需人工 qualification，组合动作也只在人工确认后运行；Retention 固定零 proposer，只有 exact retained evidence 才约束自动晋升；authoring Skill 不允许隐式注入 | `dsh-evoforge` |
| `dsh-software-delivery` | 把原生 Goal 交付为隔离、遵循仓库规范、验证过的 commit 和可选 Draft PR；可选择 exact-head 远端 checks 全绿并在一次 active Tool 调用内有界等待后才完成 | P2A.1 verifier + P2B.1 Goal completion + P2C.1 idempotent Draft PR + P2C.2 checks gate + P2C.3 bounded wait implemented；P2D.1 Evolve consumer 已接通 | Goal、ToolGoal、Skill、Shell、Sandbox、Approval | 一个稳定 Skill catalog entry；正文按需；同一个 ≤2 KiB 稳定 Tool Schema 覆盖可选 PR/checks/wait；host 配置开关不改变模型表面；无 Prompt | `dsh-evoforge`，成熟后可独立采用 |
| `dsh-github-review` | allowlist 人类对当前 Draft PR exact head 请求修改后，将有界、不可信 review 追加到原 Session，继续同一 Goal | P3.2 implemented；真实 DSH follow-up、崩溃去重、有界 Storage、cache parity、tarball 生命周期和公开 GitHub API 已测；真实 reviewer/多日 soak 待验证 | `complete_delivery` Tool result、Agent、Session、Storage Domain、GitHub read-only REST | 0 Tool/Skill/Prompt/System Message；无 review 时 0 模型调用/Session token；actionable 时只在缓存尾部追加一条 bounded user message | `dsh-evoforge` |
| `dsh-doctor` | 一次命令读取当前原生 Loader，把 Runtime Readiness 归约成三态、阻塞插件与下一步；只诊断不修复 | implemented；真实 tarball add/dump/boot/remove 已通过 | Commands、Loader | 一个 human Command；0 Tool/Skill/Prompt；无轮询 | `dsh-evoforge` |
| `dsh-telegram` | 一个静态授权的 Telegram 私聊持续使用同一个稳定 DSH Agent，并收到所有完成 turn、Command 结果与一次性 Approval | AS-1 implemented；真实 Loader/Agent Loop、Storage 重启、429、callback、tarball add/boot/remove 已通过；真实 Bot/Hermes paired 待验证 | Agent、Session、Commands、Approval、Storage Domain、Goal/Schedule continuation | 0 Tool/Skill/Prompt；route、offset、approval 和 delivery 全在 host plane；空闲和普通 Session 0 token | `dsh-evoforge` |
| `dsh-evolve-telegram` | Candidate 或 Evaluator Draft 需要用户处理时，经既有 exact Telegram 私聊发送一次提醒，原会话继续 | P3.1 implemented；supervisor signal、durable 去重、不确定发送、cache parity 与 tarball 生命周期已测；真实 Bot/移动端/多日 soak 待验证 | Evolve control service、Telegram exact host route、Storage delivery journal | 0 Tool/Skill/Prompt/Command；无模型调用、timer 或动态 Session 表面；普通 Session 0 token | `dsh-evoforge` |
| `dsh-goal-continuity` | 进程重启后，exact 静态授权的持久 Session 可自动继续仍 active 的原生 Goal，不必每次人工 `/goal resume` | LC-1 implemented；真实 JSONL 冷恢复、`SIGKILL`、人工恢复 cache surface 等价与 tarball add/boot/remove 已通过；生产多日 soak 待验证 | Agent Session start、Goal、原生 Goal round driver | 0 Tool/Skill/Prompt/Command；只在 cold-resume 边沿 rearm；不扫描 Session、不新增状态库或预算账本 | `dsh-evoforge` |
| `dsh-resident` | 通过 DSH `/resident` 把一个 exact profile 配置为 OS user service，退出或崩溃后自动拉起，并能显式查看和删除 | LC-2 implemented；原生 Bundle/Command、无 bin tarball、macOS 真 `launchd` 启动/`SIGKILL`/新 PID/删除、systemd unit 与 manager 协议已测；Linux 真机 crash 和多日 soak 待验证 | Commands；外部复用 `launchd`/`systemd` | 1 human Command；0 Tool/Skill/Prompt/模型调用；无 daemon 或状态库，普通模型请求不变 | `dsh-evoforge` |
| `dsh-channel-router` | 把一个静态授权的外部 endpoint 精确绑定到原生 Workspace、Session 和 Agent，供多个薄 Adapter 共用 | core implemented；双 Workspace、持久 ingress、Command 一次执行、无 bin tarball 已测；Adapter 迁移和真实渠道待验证 | WorkspaceRegistry、Agent、Session persistence、Agent presets、Commands、Storage Domain | 0 Tool/Skill/Prompt/Command；route 与幂等状态只在 host plane；普通 Session 0 token | `dsh-evoforge` |

`dsh-evolve` 内部的 Observer、Candidate Lab、Trial Runner、Decision、Release、Monitor 和 Generation Binder 不是独立插件。它们只有组合起来才产生一个用户结果，拆开只会增加配置、版本和缓存理解成本。

`dsh-software-delivery` 对不启用进化的用户仍有完整价值，因此是第二个插件，而不是 `dsh-evolve` 的私有 evaluator。

## 尚未进入路线图的候选

| 候选 | 进入条件 | 为什么现在不建 |
|---|---|---|
| `Control Center` | 至少 `Evolve` 与另一个插件需要同一状态投影，并且 CLI/Web 两个 Adapter 已证明公共契约 | P0C 先由 `Evolve` 自己提供 command/view，避免预建 UI 平台 |
| 下一个 Assistant Adapter | Telegram 以外的一个消息、日程、内容或个人助理工作流同时具备独立高频需求、明确权限边界和可验证 outcome | `dsh-evolve-telegram` 只是既有 Telegram route 的组合插件，不是第二渠道；第二个真实场景未有证据前不提取通用 Gateway |
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
`dsh-evolve-web`、`dsh-software-delivery`、`dsh-github-review`、`dsh-doctor`、`dsh-telegram`、`dsh-evolve-telegram`、
`dsh-goal-continuity`、`dsh-resident` 和 `dsh-channel-router`。可发布包的本地
打包安装/卸载边界已验证；npm 尚未发布，发布前仍需版本策略、第三方安装验收与发布授权。
