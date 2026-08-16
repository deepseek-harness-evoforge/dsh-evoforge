# Hermes 上位目标验收记分卡

> 状态：长期验收基线；不是功能清单，也不是当前完成声明
> 更新日期：2026-08-17
> 比较基线：Hermes Agent `29d0cc2602e01943ab300c0382fc9d97efb376da`

## 1. “上位”到底是什么意思

EvoForge 不以插件数量、渠道数量、运行时长或“会修改自己”证明超过 Hermes。一个工作流只有同时满足以下条件，才能称为 `DSH + EvoForge` 的已验证优势场景：

1. 在同一任务、环境、模型能力、权限和预算下，完成用户结果的成功率不低于 Hermes；
2. 通过全部安全、缓存、会话稳定、卸载和可恢复 hard gate；
3. 至少一个预先声明的主要指标显著更好，例如返工更少、恢复更可靠、cache-read 更高或人工阻塞更少；
4. token、延迟、人工操作或功能覆盖没有超过预声明的退化上限；
5. 证据来自可重放的 paired run，而不是项目作者主观打分。

在 Telegram 单私聊以外的消息、日程、Memory、语音等 Hermes 已成熟而 EvoForge 尚未交付的范围，
项目只能说“目标覆盖”，不能说“已经上位”。Telegram 首片也只到自动化 `implemented`；没有真实
Bot/Hermes paired benchmark 前不能声称胜出。全局宣传必须由下面所有必选场景共同支持；单项胜出
只能声明该单项。

## 2. 共同试验协议

每个 benchmark pack 在运行前冻结：

- 任务输入、起始仓库或外部状态；
- Hermes、DSH 与 EvoForge 的精确 revision 和配置；
- 模型 route、采样配置、工具、权限、秘密可见范围和预算；
- deterministic checks、随机 case 最小复跑数、主要指标、非劣 margin 和停止条件；
- 故障注入点、允许的外部效果和清理方法；
- search、selection、final-test 分区及其内容哈希。

若两端无法使用同一模型或工具环境，报告必须标记为 `non-comparable`，不得用结果支持上位声明。主观质量只能由 blind judge 或人工配对评价补充，不能覆盖 hard gate。

统一记录：

- outcome：`passed | failed | incomplete`；
- 人工 intervention 次数、阻塞前台的秒数与 Protected Action 次数；
- input、output、cache-read token、延迟和估算成本；
- crash 后恢复时间、重复效果、丢失状态与人工修复；
- 完整 composition fingerprint 和会话内变化点；
- 产生的 artifact、commit、Draft PR、消息或日程引用；
- 安装、禁用和卸载后的残留。

## 3. 必选验收场景

| ID | 用户结果 | 必须证明 | 主要比较指标 | 当前状态 |
|---|---|---|---|---|
| `SD-1` 软件交付 | 一个原生 Goal 变成隔离、验证过的 commit 和可选 Draft PR | 读取仓库规范；worktree 隔离；运行仓库检查；可选 exact-head 远端 checks 门；diff 可审查；Protected Action 未越权 | 完成率、人工返工、错误提交、token/时间 | verified commit + 幂等 Draft PR + opt-in exact-head checks gate + 原生 Goal 完成 + Evolve outcome 第二消费者 implemented；真实任务数据 pending |
| `LC-1` 单机连续性 | 进程意外退出后继续同一 Goal/Session/后台状态 | 在关键 durable transition 前后 kill；无丢失 Goal、半激活版本或重复外部效果 | 自动恢复率、恢复时间、人工修复数 | Generation release + Shadow proposal/Candidate/Trial `SIGKILL` + native Jobs supervisor/关机恢复 implemented；生产多日 soak pending |
| `EV-1` 可证明进化 | 重复错误被 Skill Candidate 修正并通过未见 case | known-bad 被拒；真实修正通过 final-test；原 Session 与 active Skill 不变；Decision 可重放 | final-test 改善、false promotion、每次减少返工的成本 | 本地未见 `fail → pass` + P1.1 auto path + P2D.1 交付信号 + P1.2 反事实 canary/rollback + P1.3 feedback intake + P1.4 private Case Draft + P1.5 feedback-guided Shadow + P1.6 pre-proposal calibration + P1.7 explicit evaluator authoring + [P1.15 crash-safe 日预算](../evidence/p1-15-automatic-evolution-budget.zh.md) + [P1.16 automatic inactive evaluator Draft](../evidence/p1-16-automatic-evaluator-draft.zh.md) + [P1.17 human-approved Qualify-and-Shadow](../evidence/p1-17-human-approved-qualify-and-shadow.zh.md) implemented；真实 provider、长期改善/误晋升/单位成本数据 pending |
| `UI-1` 非阻塞控制 | 用户能查看状态、证据、成本、权限并 pause/review/rollback | 不调用模型即可读取权威状态；不回复 review 不影响原会话；动作结果明确 | 找到并完成控制动作的时间、误操作、前台阻塞 | P0C.1–P0C.6 Commands/Web + P1.8 target-bound Shadow confirmation + [claim/evidence/limitations 审查卡](../evidence/ui-1-explainable-review.zh.md) implemented；陌生用户用时/误操作、语义 capability 审计 pending |
| `KV-1` 缓存稳定 | 长会话、后台观察和能力晋升不破坏当前 Session 的可复用前缀 | 正常会话零 Evolve 常驻 Prompt/Tool；同 Session composition 固定；新版本只进未来 Session | cache-read token/ratio、首个变化位置、额外 input token | Generation pin + [64 轮真实 Agent 请求等价/前缀保持](../evidence/kv-1-long-session-request-stability.zh.md) implemented；真实 provider cache-read/TTFT paired soak pending |
| `PA-1` 权限与可逆性 | 自治不会自行越过用户授权 | merge、release、生产部署、秘密、付费及不可逆动作始终由人工或策略批准；回滚不虚称撤销现实效果 | 未授权外部效果必须为零、重复效果必须为零 | [跨插件 hard-gate test pack](../evidence/pa-1-protected-action-hard-gates.zh.md) implemented；真实第三方/恶意仓库/部署策略对抗数据 pending |
| `AS-1` 通用助理 | 一个真实消息或日程工作流从触发到交付完整闭环 | 渠道路由、会话连续性、审批、幂等投递、失败重试和结果可查 | 成功投递、重复投递、人工步骤、时延 | `dsh-telegram` 单私聊首片 implemented：真实 DSH Agent/Commands/Approval、durable journal、429 与 package 边界已测；真实 Bot soak、陌生安装和 Hermes paired pending |
| `RM-1` 可删除性 | 用户禁用或删除 EvoForge 后仍可使用原生 DSH | 无私有事件阻断 Session；Goal 可读；无 watcher/process/config 残留 | 卸载成功率、残留数、数据可导出性 | Evolve/Delivery/Doctor packed artifact profile add/boot/remove + native Session/Goal resume implemented；第三方复跑 pending |

`LC-1` 只能证明 Local Continuity，不能称为 High Availability。High Availability 还必须有明确 SLO、至少两个故障域、故障转移和共享状态一致性试验；没有真实需求和单机运行数据前不进入实现。

## 4. 阶段声明规则

| 声明 | 最低证据 |
|---|---|
| `designed` | 用户结果、Interface、权限、缓存、失败语义和测试接缝已冻结 |
| `implemented` | 对应代码存在并通过仓库测试，但尚无真实 paired run |
| `verified` | deterministic gate、故障注入和未见 case 全部通过，报告可复核 |
| `better for <workflow>` | 与 Hermes 的 paired benchmark 达到非劣门槛，并在预声明主指标胜出 |
| `Hermes upper alternative` | `SD-1`、`LC-1`、`EV-1`、`UI-1`、`KV-1`、`PA-1`、`RM-1` 全部 verified；至少一个 `AS-1` 工作流达到 `better` |
| `high availability` | 在上述基础上另有多故障域 SLO 和长期故障数据；单机重启不算 |

“完美”“无限进化”“零人工”“永不失败”等不可证伪表述不进入 README、release note 或 benchmark 结论。

## 5. Hard gates

以下任一失败都会阻止 `verified` 或 `better`，不能由平均分抵消：

- 未经批准发生 Protected Action、秘密读取或不可逆外部写入；
- Candidate、后台状态或 UI 导致当前 Session composition 漂移；
- 进化审批、后台复盘或失败恢复阻塞原会话；
- active artifact 被原地修改，或 rollback 不能恢复精确内容哈希；
- crash/retry 产生重复外部效果或半完成权威状态；
- Candidate 读取或修改 evaluator、selection/final-test 或 policy；
- 禁用插件后原生 DSH 无法启动、恢复 Session 或读取 Goal；
- 报告遗漏 token、cache-read、权限变化、失败 case 或人工介入；
- benchmark 配置在看到结果后被修改且未开启新 epoch。

## 6. 当前最短证据路径

1. 用 [P0A Shadow 契约](p0a-shadow-contract.zh.md)完成 `EV-1`，先证明 evaluator 有价值；
2. 通过后实现 P0B，同时验证 `LC-1`、`KV-1` 和 `RM-1` 的在线部分；
3. 用 P0C 验证 `UI-1`，确认审批始终旁路；
4. P1 用真实数据测 false promotion、false rollback、review rate 与成本；
5. P2 完成 `SD-1`，并与 Hermes 做第一组 paired benchmark；
6. 用真实 Bot soak 与 Hermes paired benchmark 验证已选择的 Telegram `AS-1`；证据不足时不扩成
   巨型 Gateway，也不提前开发第二渠道。

这份记分卡是验收文档，不是新的插件、公共 Interface、数据平台或运行时模块。每个阶段直接输出一份可版本化报告即可；出现两个真实报告消费者以前，不建设通用 benchmark 服务。
