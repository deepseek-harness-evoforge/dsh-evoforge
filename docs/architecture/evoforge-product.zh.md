# EvoForge 产品架构

> 状态：产品边界已确认；首个 Assistant Adapter 与进化注意力桥已实现
> 更新日期：2026-08-17

## 1. 产品结果

EvoForge 不是第四套 Agent Runtime。它让 DSH 在选定真实工作流中成为比 Hermes 更可靠、更可控、更节省缓存并能用证据持续进化的长期 Agent。

```text
人类交互面
  └─ status / timeline / evidence / approve / pause / rollback
                         │
DSH Runtime ─ Goal / Session / Tool / Approval / Storage / Jobs / Skill
                         │
EvoForge 可选能力
  ├─ Evolve：从真实结果产生、评测和发布能力候选
  ├─ Software Delivery：隔离、验证、commit、Draft PR
  ├─ Telegram Adapter：一个私聊持续使用一个稳定 DSH Agent
  ├─ Evolve Telegram：待处理进化决定发送到既有私聊
  ├─ Goal Continuity：授权固定 Session 在重启后继续原生 Goal
  └─ Resident：用户级 OS service 拉起 exact DSH profile
```

DSH 始终拥有模型执行和基础服务；EvoForge 插件只增加用户结果。插件卸载后，原生 DSH Session 和 Goal 仍可恢复。

## 2. 首批能力边界

### dsh-evolve

旗舰插件。P0A 只提供离线 Shadow；证明 evaluator 有价值后，才增加 Generation、Session pin、晋升、监测和回滚。Observer、Trial Runner、Decision 和 Release 都是内部模块，不拆成浅插件。

### dsh-software-delivery

独立插件。它把一个原生 Goal 交付为隔离 worktree、仓库检查、可审查 diff、commit 和可选 Draft PR；仓库也可选择 exact-head 远端 checks 全绿后才完成 Goal，并可在一次 active Tool 调用内有界零模型等待。即使不启用 Evolve，它仍有完整用户价值；启用后，它提供第一组强 outcome signal。

### dsh-telegram

首个 Assistant Adapter 已选择 Telegram 单私聊：一个 Bot、一个 exact private chat/user、一个带
稳定 `sessionId` 的既有 DSH Agent。它复用原生 Commands、Approval、Goal 与 Schedule，不创建
第二 Session 或 Gateway；0 Tool/Skill/Prompt。真实 Bot/Hermes paired benchmark 之前只标记为
`implemented`。下一个消息、日程、内容或个人助理 Adapter 仍需独立用户需求与 outcome 证据。

### dsh-evolve-telegram

单用途组合插件。它只在 Evolve 已有 Candidate 或 Evaluator Draft 需要处理时，经 `dsh-telegram` 的
exact 私聊发送一条有界提醒；重启与重复扫描复用 Telegram durable journal。消息不是 Approval，动作
仍走 `/evolve`，原 Session 不等待。它不创建 timer、第二状态机、通知平台或公开 Adapter SPI，0
Tool/Skill/Prompt/Command/模型调用，普通 Session token 增量为 0。

### dsh-goal-continuity

独立、默认关闭的 Local Continuity 插件。部署者只配置 exact 持久 Session allowlist；当 DSH 冷恢复
该 Session 时，插件仅 rearm 仍 active 且未耗尽的原生 Goal，后续完全交回原生
`goal-round-driver`、轮次上限和 Approval。它不扫描 Session、不管理进程、不建 Mission、任务库或
重试平台，0 Tool/Skill/Prompt。静态授权不能区分崩溃与有意重启，因此两者都会继续。

### dsh-resident

独立的进程层 Local Continuity CLI。一个只读 plan 把 exact absolute Node、DSH entry、profile、home 和
workspace 变成完整 launchd/systemd unit；逐次确认后才 apply 或 remove。OS manager 和 unit 是唯一
权威，CLI 随即退出。它不进入 DSH Loader，不建 daemon、状态库或公共 supervisor API，0
Tool/Skill/Prompt/模型调用。与 Goal Continuity 组合时，Resident 只恢复进程，Goal Continuity 只决定
exact Session 的原生 Goal 是否被授权继续。

当前不创建独立的 Mission、Supervisor、Cache、Policy、Memory、Event Store 或通用 UI 平台插件。两个真实消费者出现前，共享接缝留在插件内部。

## 3. 交互契约

交互是产品能力，不是模型 Prompt。

所有界面 Adapter 投影同一组权威状态：

- Goal、阶段、进度、阻塞原因和下一步；
- Candidate claim、diff、case、baseline/candidate 结果；
- token、latency、完整 composition cache 指标；
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
2. 默认不增加常驻 Evolve system prompt 或模型工具。
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
| 消息与日程 | 按真实 workflow 提供可拆 Adapter | Telegram 单私聊与 Evolve 注意力桥 implemented；真实 Bot/Hermes paired 与其他场景 pending |
| 人类控制 | 状态、证据、审批、暂停、回滚不阻塞会话 | P0C Commands/Web + P3.1 非阻塞 Telegram attention + P3.2 Draft PR review follow-up implemented；语义 capability 审计与陌生用户可用性数据 pending |
| 自进化 | 独立 final-test、inactive Candidate、可证明晋升 | P0A `fail → pass` + P0B verified-Git/resident resume + P0C inactive publication + P1.1 opt-in auto policy + P2D.1 Outcome + P1.2 exact-parent 反事实回滚 + P1.3 feedback intake + P1.4 private Case Draft + P1.5 feedback-guided Shadow + P1.6 pre-proposal calibration + P1.7 explicit evaluator authoring + P1.8 target-bound launch + P1.9 private Evaluator Draft/human qualification + P1.15 crash-safe automatic budget + P1.16 opt-in automatic inactive Evaluator Draft + P1.17 human-approved Qualify-and-Shadow + P1.18 per-Skill automatic inflight gate + P1.19 bounded automatic ambiguous review + P1.20 review-window visibility + P1.21 parent outcome comparison；真实 provider、陌生用户与长期效果 pending |
| 权限 | 代码和外部效果不自动激活 | 需求与测试门已定义 |
| KV Cache | Session 内完整 composition 稳定 | 真实两轮 Agent 前缀与 Tool surface 回归通过；长会话 cache token soak pending |
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

## 8. 最小路线

1. **P0A**：`dsh-evolve shadow <skill-dir>`，一个真实 Skill、独立 final-test、已知坏 Candidate 和至少一个真实修正。
2. **P0B**：Generation、Session pin、原子 active pointer、crash recovery、composition fingerprint。
3. **P0C**：host command/view、异步人工晋升和 rollback。
4. **P1**：权限效果不变的纯指令 future-session canary 与窄自动晋升。
5. **P2**：Software Delivery 正式产品化；代码 Candidate 只到 Draft PR。
6. **P3**：Telegram 单私聊 Adapter、P3.1 Evolve 注意力桥与 P3.2 Draft PR 审查返修 implemented；下一门是实际 Bot/reviewer soak、陌生安装与 Hermes paired benchmark，不是扩渠道或建通知/Review 平台。
7. **LC-1**：exact Session 原生 Goal 冷恢复 implemented；下一门是生产多日恢复率/时延，不是扩成 daemon 或 HA 平台。
8. **LC-2**：用户级 launchd/systemd service implemented；下一门是 Linux 真机与多日运行，不是再建第二 supervisor。

每一阶段未达到可验证退出条件时停止扩张，不用更多插件或基础设施掩盖失败。
