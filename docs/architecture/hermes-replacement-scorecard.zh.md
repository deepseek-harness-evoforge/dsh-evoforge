# Hermes 上位目标验收记分卡

> 状态：长期验收基线；不是功能清单，也不是当前完成声明
> 更新日期：2026-08-24
> 已有 paired epoch 比较基线：Hermes Agent `29d0cc2602e01943ab300c0382fc9d97efb376da`
> 历史生态审计基线保留用于既有证据；2026-09-03 当前远端 revision 已单独复核为 Hermes Agent `63279301bcbdc185c1b07b98a9312eb0c862f26d`、OpenClaw `1fb3e0ca33847b5827a21cf5cb132d3f90ff49ad`、HanaAgent/openhanako `1d3ef308299e9f630786384e77de45444ea59196`，详见[当前 revision 复核](../research/ecosystem-current-revision-2026-09-03.zh.md)。
> V5.13 已从当前内容寻址 Generation 路径重跑旧 revision 的四个 frozen deterministic epoch；EV-1 不再引用已删除的 Git Skill source，冻结结果保持不变。该复跑不把旧 epoch 升格为当前 Hermes revision 或真实模型证据。

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
- Candidate 前密封的 authoring、admission、holdout、Retention 分区及其内容哈希。

若两端无法使用同一模型或工具环境，报告必须标记为 `non-comparable`，不得用结果支持上位声明。主观质量只能由 blind judge 或人工配对评价补充，不能覆盖 hard gate。

统一记录：

- outcome：`passed | failed | incomplete`；
- 人工 intervention 次数、阻塞前台的秒数与 Protected Action 次数；
- input、output、cache-read token、延迟和估算成本；
- crash 后恢复时间、重复效果、丢失状态与人工修复；
- 完整 composition fingerprint 和会话内变化点；
- 产生的 artifact、commit、Draft PR、消息或日程引用；
- 安装、禁用和卸载后的残留。
- Goal 到 Skill 的自动路由结果、候选集合、abstain 与人工选路/纠正次数；
- Skill 发现召回、错误调用、首次成功、跨任务复用/迁移、负迁移、保留与遗忘；
- signal → gap → candidate → trial → decision → generation 的完整谱系和内容哈希。

## 3. 必选验收场景

| ID | 用户结果 | 必须证明 | 主要比较指标 | 当前状态 |
|---|---|---|---|---|
| `DS-1` 内部经验自我发现 | 用户只给自然语言 Goal，系统无需开场菜单即可调用正确的已安装 Skill，或从 DSH 自身经验形成真实缺口、Opportunity 和可评测 Candidate | Capability Map 可解释；现有能力优先；Opportunity 只引用内部证据；Candidate identity/scope/version/hash/权限可追踪且 inactive；部署策略不预选 Skill；proposer/verification 隔离；错误路由和未知代码 fail closed；无运行时外部能力获取 | 首次成功率、Opportunity precision/recall、错误调用、人工选路/纠正、transfer、negative transfer、token/时延 | [内部 Skill Opportunity](../evidence/v4-8-internal-skill-opportunity-discovery.zh.md)、[V4.21 现有 Skill 精确版本调查](../evidence/v4-21-existing-skill-improvement-investigation.zh.md)、[V4.34 同一完整基线资格](../evidence/v4-34-existing-skill-baseline-qualification.zh.md)、[V4.35 现有 Skill 纠正证据密封](../evidence/v4-35-existing-skill-correction-evidence-seal.zh.md)、[V4.38 Candidate 不可见 holdout 治理](../evidence/v4-38-existing-skill-candidate-blind-holdout-governance.zh.md)、[V4.39 exact paired holdout](../evidence/v4-39-existing-skill-exact-paired-holdout-evaluation.zh.md)、[V4.41 exact Retention](../evidence/v4-41-existing-skill-exact-retention-evaluation.zh.md)、[V4.42 Retention Web/浏览器](../evidence/v4-42-existing-skill-retention-web-browser.zh.md)、[内部 Candidate 边界](../evidence/v4-9-internal-skill-candidate-boundary.zh.md)、[Opportunity-bound Envelope](../evidence/v4-13-opportunity-bound-evaluation-envelope.zh.md)、[真实 capability-absent baseline](../evidence/v4-14-capability-absent-baseline.zh.md)、[内容寻址新 Skill Generation](../evidence/v4-15-content-addressed-new-skill-generation.zh.md)、[独立 Retention Case Pack](../evidence/v4-25-independent-retention-case-pack.zh.md)、[exact Candidate Retention](../evidence/v4-26-exact-candidate-retention-execution.zh.md)、[Shadow/Retention Web 投影](../evidence/v4-27-shadow-retention-web-projection.zh.md)、[真实浏览器恢复](../evidence/v4-28-shadow-retention-real-browser.zh.md)、[Retention Promotion Eligibility](../evidence/v4-29-retention-promotion-eligibility.zh.md)与[missing-Skill 最终包回滚](../evidence/v4-49-missing-skill-canary-rollback-final-browser.zh.md) implemented/verified；配置式 targets 已删除，Candidate 生成前从内部 Goal 内容寻址密封 authoring/admission/holdout/可选 Retention，proposer 只见 authoring；Candidate v2、Lineage v3、Envelope v4/v5 显式绑定 seal，治理作者不读取 Candidate，零 proposer 校准后原子安装治理包，paid-call uncertain 不重试；占位 Skill baseline 被拒绝，真实 assembled baseline 不安装目标 Skill，新 Skill 不依赖 Git source 并只影响未来 Session；promotable Shadow 在同一 Jobs 任务运行内容寻址 Retention，结果无发布权且不查 Git/网络；独立 Host gate 只把 exact retained 证据转换为 future-Session eligibility，错配/回归 fail closed，最终 tarball 已完成浏览器 eligible→blocked→失败→恢复；现有 Skill 已完成调用时完整 Bundle、同一 baseline 资格、真实纠正 protected split、Candidate-blind assembled Holdout/Retention Case Pack、whole-tree author/Candidate、exact 双树结构准入与 exact paired Holdout/Retention，并从最终 tarball 完成分步 approve/promote、Canary、断连保留、expected-active rollback、冷恢复、reload 与卸载；缺失 Skill 的同类最终包故障恢复也已完成；[RP-1 双真实 Provider 门](../evidence/v4-55-real-provider-acceptance-gate.zh.md)已实现但严格为 `NOT_RUN`，两套真实 provider assembled 整链、rework/cost/reuse、迁移/成本门禁及同条件 paired benchmark 仍 pending |
| `SD-1` 软件交付 | 一个原生 Goal 变成隔离、验证过的 commit 和可选 Draft PR，并能在 exact-head 人类审查后返修 | 读取仓库规范；worktree 隔离；运行仓库检查；可选 exact-head 远端 checks 门/有界等待；allowlist review 回到原 Session；diff 可审查；Protected Action 未越权 | 完成率、人工返工、错误提交、从 review 到 verified push 的时长、token/时间 | [确定性 Hermes paired completion-control slice](../evidence/sd-1-hermes-paired-benchmark.zh.md) 达到“辅助 judge unavailable 时 checked Goal completion control 更优”；verified commit、Draft PR、checks、review follow-up 均 implemented；同模型真实编码任务、远端 reviewer 数据 pending |
| `LC-1` 单机连续性 | 进程意外退出后继续同一 Goal/Session/后台状态 | 在关键 durable transition 前后 kill；OS manager 拉起 exact profile；无丢失 Goal、半激活版本或重复外部效果 | 自动恢复率、恢复时间、人工修复数 | [确定性 Hermes paired crash-recovery slice](../evidence/lc-1-hermes-paired-benchmark.zh.md) 在“权威工作不丢、单次恢复、无重复记录”上 `0:0` 打平；Generation/Shadow `SIGKILL`、Goal 冷恢复与真实 macOS DSH PID restart 均 implemented；真实模型长任务、Linux 真机与生产多日 soak pending |
| `EV-1` 可证明进化 | 重复错误被 Skill Candidate 修正并通过未见 case | known-bad 被拒；真实修正通过 final-test；原 Session 与 active Skill 不变；Decision 可重放 | final-test 改善、false promotion、每次减少返工的成本 | [一个确定性 Hermes paired release-control slice](../evidence/ev-1-hermes-paired-benchmark.zh.md) 已达到 `better for deterministic Skill-correction release control`；P0A–P1.21 其余实现不变；真实 provider、同任务分布的长期改善/误晋升/单位成本数据 pending |
| `UI-1` 非阻塞控制 | 用户能查看状态、证据、成本、权限并 pause/review/rollback | 不调用模型即可读取权威状态；不回复 review 不影响原会话；动作结果明确 | 找到并完成控制动作的时间、误操作、前台阻塞 | P0C Commands/Web + P1.8 target-bound confirmation + [审查卡](../evidence/ui-1-explainable-review.zh.md) + [P3.1 渠道 attention](../evidence/p3-1-evolve-channel-attention.zh.md) + [V4.27 Shadow/Retention Web 投影](../evidence/v4-27-shadow-retention-web-projection.zh.md) implemented；[V4.28](../evidence/v4-28-shadow-retention-real-browser.zh.md) 已验证新视图真实浏览器 reload/失败/恢复，[V4.29](../evidence/v4-29-retention-promotion-eligibility.zh.md) 已验证 promotion eligibility 的 enabled/blocked/恢复，[V4.32](../evidence/v4-32-exact-canary-rollback-gate.zh.md) 已实现 exact Canary confirmation 与 expected-active Host gate，[V4.48](../evidence/v4-48-existing-skill-canary-rollback-final-browser.zh.md) 与 [V4.49](../evidence/v4-49-missing-skill-canary-rollback-final-browser.zh.md) 已分别从最终包验证 existing-Skill/missing-Skill rollback 的失败可见、快照保留、恢复、持久化和卸载；[V5.10](../evidence/v5-10-generation-selection-history.zh.md) 又把每次 pointer mutation 的前后 Generation/authority 原子保留并从最终包验证晋升、reload、两次 Host 冷恢复、Canary 回滚和卸载；陌生用户用时/误操作与语义 capability 审计 pending |
| `KV-1` 缓存稳定 | 长会话、后台观察和能力晋升不破坏当前 Session 的可复用前缀 | 正常会话零 Evolve 常驻 Prompt/Tool；同 Session composition 固定；新版本只进未来 Session；外部 review 只追加尾部 | cache-read token/ratio、首个变化位置、额外 input token | Generation pin + [64 轮真实 Agent 请求等价/前缀保持](../evidence/kv-1-long-session-request-stability.zh.md) + [全套件 composition gate](../evidence/kv-2-suite-composition-gate.zh.md) + [P3.2 normal-request parity](../evidence/p3-2-github-review-followup.zh.md) implemented；真实 provider cache-read/TTFT paired soak pending |
| `PA-1` 权限与可逆性 | 自治不会自行越过用户授权 | merge、release、生产部署、秘密、付费及不可逆动作始终由人工或策略批准；回滚不虚称撤销现实效果 | 未授权外部效果必须为零、重复效果必须为零 | [跨插件 hard-gate test pack](../evidence/pa-1-protected-action-hard-gates.zh.md) implemented；真实第三方/恶意仓库/部署策略对抗数据 pending |
| `AS-1` 通用助理 | 一个真实消息或日程工作流从触发到交付完整闭环 | 渠道路由、会话连续性、审批、幂等投递、失败重试和结果可查 | 成功投递、重复投递、人工步骤、时延 | [确定性 Telegram approval paired slice](../evidence/as-1-hermes-paired-benchmark.zh.md) 在错误身份/重放解析动作上 `0:0` 打平；Telegram/飞书真实 DSH routes、durable journals、429、[有界 send/dispose](../evidence/v5-7-bounded-channel-delivery.zh.md)与 cache parity implemented；[V5.18](../evidence/v5-18-native-schedule-feishu-delivery.zh.md) 证明官方 Schedule 到 exact 飞书线程，[V5.19](../evidence/v5-19-native-schedule-process-restart.zh.md) 在 rc.5/rc.2 证明 durable create 的 cold resume 与第三次启动不重放，[V5.20](../evidence/v5-20-schedule-dispatch-crash-outbound-dedup.zh.md) 又证明平台效果已发生但 dispatch 未 durable 时恢复不重复平台 send；[V5.21](../evidence/v5-21-real-feishu-native-schedule-gate.zh.md) 已把真实飞书 gate 升为 exact 入站/回复/Command/官方 Schedule/Approval/卸载/readback epoch-2，但 direct/group 都是 `NOT_RUN`；真实 Bot/App delivery、Schedule 窄窗口模型/成本重复、陌生安装和同模型消息 paired pending |
| `RM-1` 可删除性 | 用户禁用或删除 EvoForge 后仍可使用原生 DSH | 无私有事件阻断 Session；Goal 可读；无 watcher/process/config 残留 | 卸载成功率、残留数、数据可导出性 | Evolve/Delivery/GitHub Review/Doctor/Telegram/Attention/Goal Continuity packed artifact lifecycle + `dsh-resident` stop/unit removal/no third restart + native Session/Goal resume implemented；保留日志明确披露，第三方复跑 pending |

DS-1 的 existing-Skill 证据新增 [V4.40 Candidate 前 Retention 治理](../evidence/v4-40-existing-skill-pre-candidate-retention-governance.zh.md)、[V4.41 exact Retention](../evidence/v4-41-existing-skill-exact-retention-evaluation.zh.md)、[V4.42 权威 Web/真实浏览器](../evidence/v4-42-existing-skill-retention-web-browser.zh.md)、[V4.43 独立发布门](../evidence/v4-43-existing-skill-release-host-gate.zh.md)、[V4.44 release Control/Web](../evidence/v4-44-existing-skill-release-control-web.zh.md)、[V4.45 最终包浏览器](../evidence/v4-45-existing-skill-release-final-browser.zh.md)、[V4.46 failed-Outcome Canary](../evidence/v4-46-existing-skill-failed-outcome-canary.zh.md)、[V4.47 Canary Control/rollback](../evidence/v4-47-existing-skill-canary-control-rollback.zh.md)与 [V4.48 最终包回滚生命周期](../evidence/v4-48-existing-skill-canary-rollback-final-browser.zh.md)：五 Goal Candidate 的 Envelope 绑定两个独立单样本治理调用和两套 Case Pack hash，只有权威 improved Holdout 才由原生 DSH Jobs 执行 exact Retention；四 Goal/legacy 零花费 abstain，四象限与 paid-uncertain 不重试均无发布权。V4.43 由独立 Host gate 在人工批准后发布 inactive Generation，再单独选择未来 Session；真实 DSH Session 已证明同名替换、旧 Session固定、显式回滚和二进制整包保留。V4.44 已证明 Control、固定 Typert Remote 与 Web 只投影/调用同一 Host owner；V4.45 又从最终 tarball 证明发布生命周期；V4.46 已证明 active release failed-Outcome 的 exact paired Canary Host/Jobs、严格 rollback eligibility 与无 mutation authority；V4.47 已证明 distinct Control/Remote/Web action 由独立 Host gate 重验 exact evidence 并 expected-active 回滚；V4.48 又从最终包证明该链在断连、整页 reload、进程重启和官方卸载下成立。两套真实 provider 与长期效果证据仍 pending。

UI-1 同步纳入 V4.42：Retention 卡片由 Host bounded summary 驱动，显示 exact identity/tree、四象限、完整性、model/token/cache 和无发布权；真实浏览器已验证刷新失败显式可见且最后成功证据不丢失。V4.44 已把 existing-Skill release gate 的 exact baseline/Candidate/diff/evidence 与分步 approve/reject/promote 接入同一 Control/Remote/Web；V4.45 已完成该门的最终 tarball 真实浏览器故障恢复与卸载；V4.47 已增加 failed-Outcome Canary bounded card 与独立确认式 rollback action；V4.48 已从最终 tarball 验证该动作的失败可见、最后证据保留、恢复、精确回滚、reload、冷重启和卸载。

V5.10 为 UI-1 增加的只是 mutation audit：Host/Web 能显示每次 future-Session pointer 变更的 sequence、前后 Generation 和 exact authority/evidence，并在 reload、Host 冷恢复后保持；它不把一次选择包装成 Outcome、因果效果或 release authority。长期误晋升/误回滚率仍必须来自真实 Provider 与 paired benchmark。

V5.11 为 DS-1/UI-1 增加的是 longitudinal monitoring 的最小底座：Host/Web 把每次选择后的 retained Outcome 按 Session-pinned selected/previous/other Generation 分桶，显示不同 Goal、结果、token/cache/latency/active-wall，并对边界歧义或时间倒退 abstain。最终包已验证真实 Session facts、断线保留、两次冷恢复、整页 reload 与卸载；该窗口仍是 bounded、non-causal、无 mutation authority，不能替代长期误晋升/负迁移/遗忘率或 Hermes paired 结论。

V5.12 为 EV-1/UI-1 补的是 narrow automatic release implementation，而不是新的能力获取或静态 target：部署策略只授权 Workspace；exact existing-Skill Candidate 必须同时满足 append-only `SKILL.md`、整包其余 bytes 不变、protected-effect 为空、paired Holdout 与 independent Retention 改善、model/token/cache 不回退、相同 sealed timeout/composition、durable pause 未启用及 active parent 不漂移。Host 先持久化 automatic decision 和 inactive Generation，再只改变未来 Session；原生 Jobs 从 durable facts 恢复，Web 只读显示 eligible/pending/promoted/review/paused/blocked。自动化与 Storage restart 已实现；最终 tarball 浏览器、两套真实 provider false-promotion/transfer 和长期 Hermes paired 仍 pending，因此 EV-1 的“真实可证明进化”状态不升级为完成。

`LC-1` 只能证明 Local Continuity，不能称为 High Availability。High Availability 还必须有明确 SLO、至少两个故障域、故障转移和共享状态一致性试验；没有真实需求和单机运行数据前不进入实现。

## 4. 阶段声明规则

| 声明 | 最低证据 |
|---|---|
| `designed` | 用户结果、Interface、权限、缓存、失败语义和测试接缝已冻结 |
| `implemented` | 对应代码存在并通过仓库测试，但尚无真实 paired run |
| `verified` | deterministic gate、故障注入和未见 case 全部通过，报告可复核 |
| `better for <workflow>` | 与 Hermes 的 paired benchmark 达到非劣门槛，并在预声明主指标胜出 |
| `Hermes upper alternative` | `DS-1`、`SD-1`、`LC-1`、`EV-1`、`UI-1`、`KV-1`、`PA-1`、`RM-1` 全部 verified；至少一个 `AS-1` 工作流达到 `better` |
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
- 开场要求用户选择任务类别、工作流、Agent 或 Skill，或在已有适用能力时把路由责任退回用户；
- 来源、scope、version、内容哈希或权限不明的 Skill 被静默安装、执行或晋升；
- 禁用插件后原生 DSH 无法启动、恢复 Session 或读取 Goal；
- 报告遗漏 token、cache-read、权限变化、失败 case 或人工介入；
- benchmark 配置在看到结果后被修改且未开启新 epoch。

## 6. 当前最短证据路径

1. 保持 `main` clean checkout 的全包检查、十一包 assembled 与 KV parity 持续绿色；
2. 先实现 `DS-1` 的现有 Skill 自动命中、真实 Gap、内部 Skill Opportunity 和 whole-Skill inactive Candidate；禁止运行时外部获取；
3. 用 sealed holdout 和权限故障注入证明 Candidate 无法影响 evaluator/policy，再把快环与慢环接入现有 `EV-1`；
4. 补齐 DSH Web capability/gap/lineage/eval/Feishu 视图，并以真实浏览器验证 `UI-1`；
5. 完成 exact 飞书 route 的 `AS-1` 消息、Command、Approval、重启与 uncertain 路径；
6. 以当前固定 Hermes revision 执行 `DS-1`、`EV-1`、`SD-1`、`LC-1`、`UI-1`、`KV-1`、`PA-1`、`AS-1`、`RM-1` paired epoch，并补真实 provider 长期 retention/transfer/cost；
7. 仅在声明范围全部过门后为 `main` 创建 annotated semantic tag。

这份记分卡是验收文档，不是新的插件、公共 Interface、数据平台或运行时模块。每个阶段直接输出一份可版本化报告即可；出现两个真实报告消费者以前，不建设通用 benchmark 服务。
