# 当前实现状态

> 更新日期：2026-08-17

本页是仓库完成度的权威入口。架构文档描述目标和约束，不等于能力已经实现。

## 状态词

| 状态 | 含义 |
|---|---|
| `planned` | 只有需求或设计，没有可运行实现 |
| `implemented` | 源码和自动化测试已经落地，但尚未获得真实环境/未见样本证据 |
| `verified` | 达到对应路线图退出门，证据可由第三方复核 |
| `released` | 已发布版本、安装与卸载路径均通过验证 |

## 能力矩阵

| 能力 | 状态 | 现有证据 | 进入下一状态还缺什么 |
|---|---|---|---|
| DSH/Claude Code Rev/Hermes 调研 | `verified` | [研究索引](research/README.zh.md)、固定 revision 与源码定位 | 上游 revision 改变时重新审计 |
| DSH 171 原生插件目录 | `verified` | [全量目录](research/deepseek-harness-native-plugins.zh.md) | 新 revision 重新生成统计 |
| `dsh-evolve` Shadow 安全门 | `implemented`（P0A 本地退出门通过） | [P0A.1 证据](evidence/p0a-1-owned-path-tracer.zh.md)、CLI 测试、[P0A.8 本地未见首测](evidence/p0a-8-private-heldout.zh.md) | 第三方独立复跑与真实 provider outcome |
| Sealed Trial executor | `implemented`（macOS、已接入确定性 evaluator） | [边界证据](evidence/p0a-2-darwin-sealed-trial.zh.md)、[ADR-0006](adr/0006-fail-closed-sealed-trial-execution.md) | 磁盘配额、Linux/Windows 与任意 Candidate/DSH 组装执行 |
| known-bad / known-correction 校准 | `implemented`（静态示例 + 真实 bridge + 3/3 公开产品 fixture + 本地 held-out） | [P0A.3](evidence/p0a-3-calibrated-paired-trial.zh.md)至[P0A.8](evidence/p0a-8-private-heldout.zh.md) | 更多独立真实 Case 与误报/漏报数据 |
| Candidate 的 `promote/review/reject` 评价 | `implemented`（本地 P0A 退出门通过） | paired baseline/Candidate、真实 composition、纯 Decision；冻结修正首次 held-out 为 `fail → pass` | 落盘重放、真实 provider outcome 与长期 false-promotion 数据 |
| Capability Generation 与 Session pin | `implemented`（P0B.1 + KV-1 长会话门） | [P0B.1 证据](evidence/p0b-1-generation-release-kernel.zh.md)、真实 DSH Storage/Agent/Skill 测试、[64 轮完整请求对照](evidence/kv-1-long-session-request-stability.zh.md) | 第三方复跑、更多 DSH 版本与真实 provider cache-read/TTFT 指标 |
| Git Skill 晋升与回滚内核 | `implemented`（host service + P0C Commands） | exact Git gate、future-session pointer、live Session 不漂移；[P0C.1](evidence/p0c-1-human-release-command.zh.md) 与 [P0C.2](evidence/p0c-2-review-to-inactive-generation.zh.md) | P1 自动晋升与真实 canary 数据 |
| 异步人工复核 | `implemented`（P0C.2 + P0C.4–P0C.6） | claim/files/case/cost/限制 + [exact bounded diff](evidence/p0c-4-verified-diff-preview.zh.md) + [protected-effect 词法提示](evidence/p0c-5-protected-effect-projection.zh.md) + [真实 DSH Web 控制面](evidence/p0c-6-web-control-plane.zh.md) + [真实 Chrome 可解释审查卡](evidence/ui-1-explainable-review.zh.md)；reject durable；approve 生成 inactive Generation 并关闭过期表单；Commands/Web 均零模型调用且不阻塞原会话 | 陌生用户 approve/promote/rollback 可用性数据、语义 capability/权限差异审计与可选分页/折叠 |
| Resident pause/resume | `implemented`（P0C.3） | [P0C.3](evidence/p0c-3-durable-resident-pause-resume.zh.md)：Storage 重启、release pointer 保持、活动 Trial 取消/resume 重发现、真实 Commands/Agent 零模型调用 | 生产多日 soak 与真实用户控制时延 |
| 极窄纯指令自动晋升 | `implemented`（P1.1，默认关闭） | [P1.1](evidence/p1-1-opt-in-clear-instruction-auto-promotion.zh.md)：allowlist、append-only、protected-effect gate、durable actor、崩溃续晋升、真实 future Session E2E | 长期 false-promotion 数据；P1.2 已补 canary/rollback |
| Delivery Outcome 第二消费者 | `implemented`（P2D.1） | [P2D.1](evidence/p2d-1-delivery-outcome-signal.zh.md)：真实 ToolRuntime/Storage、异步不阻塞、幂等/容量/重启、host-only 聚合、零模型请求 | 真实开发任务样本；P1.2 已补 active-vs-parent canary，单次失败仍不能直接回滚 |
| 反事实 Canary 与自动回滚 | `implemented`（P1.2，随 opt-in autoPromote） | [P1.2](evidence/p1-2-counterfactual-canary.zh.md)：exact Git parent/Candidate、原 Case Pack、macOS Sealed Trial、原生 Jobs、pointer race、crash recovery 与公开 CI | 真实任务 false-promotion/false-rollback/review rate 与多日 soak |
| 显式负反馈学习入口 | `implemented`（P1.3） | [P1.3](evidence/p1-3-explicit-feedback-intake.zh.md)：真实 DSH Message Feedback、reference-only/可撤回 Storage、host-only 聚合、重启/容量、零模型请求 | P1.4/P1.5 已提供显式私有 Draft 和反馈引导 Shadow；仍缺真实用户样本与长期候选改善率 |
| 私有 Feedback Case Draft | `implemented`（P1.4） | [P1.4](evidence/p1-4-private-feedback-case-draft.zh.md)：显式双重授权、exact feedback/Generation/Skill/content hash 归因、私有内容寻址落盘、幂等/撤回/歧义拒绝、零模型请求 | 全新失败仍需一个可信 deterministic evaluator |
| 反馈引导、独立评测 Shadow | `implemented`（P1.5） | [P1.5](evidence/p1-5-feedback-guided-shadow.zh.md)：私有草稿只进 proposer、existing Case Pack 独立判定、exact Skill gate、输入字段不直接复制、durable resume、macOS 55/55 | 真实 provider/用户纠正数据；P1.7 已补新失败 keyless 前向测试，仍需真实 outcome |
| proposer 前 Case Pack 校准 | `implemented`（P1.6） | [P1.6](evidence/p1-6-preproposal-case-pack-calibration.zh.md)：独立零模型命令、known-bad/correction sealed report、Shadow preflight、失准时 provider 0 请求、macOS 60/60 | 真实作者使用数据；Linux/Windows sealed backend；P1.7 只指导编写，不自动生成 evaluator |
| 全新失败 evaluator authoring | `implemented` workflow（P1.7） | [P1.7](evidence/p1-7-evaluator-authoring-skill.zh.md)：显式 user-invoked Skill、独立分区/negative controls、真实 assembled calibration；一个新“进度即停”失败完成 red→green→bounded Shadow→可回滚 Skill 晋升；无 runtime surface | 独立陌生作者可用性、真实 provider/任务 outcome；P1.16 可选策略只自动生成 inactive Draft，仍不自动 qualification |
| 显式 Feedback Shadow Launch | `implemented`（P1.8） | [P1.8](evidence/p1-8-explicit-feedback-shadow-launch.zh.md)：静态 Target、Commands/Web 确认、原生 Jobs、内容寻址去重、真实 DSH composition/packed 浏览器、无路径 Remote 与零模型表面 | 真实 provider/用户纠正改善率、陌生用户可用性与多日崩溃数据 |
| 私有 Evaluator Draft 与人工资格验证 | `implemented`（P1.9） | [P1.9 证据](evidence/p1-9-private-evaluator-draft.zh.md)：host-owned manifest/known-bad、生成后零执行、exact-hash 人工批准、真实 sealed DSH qualification、`SIGKILL` 付费不重试、Commands/Remote/Web、packed lifecycle 与普通 Session 零模型表面 | 真实 provider/用户纠正的 qualified/semantic-rejection/cost 数据、陌生用户可用性与多日 soak；Qualified 仍不自动启动 Shadow |
| Qualified Case Pack 显式进入 Feedback Shadow | `implemented`（P1.10） | [P1.10 证据](evidence/p1-10-qualified-shadow-handoff.zh.md)：新付费确认、host-only exact path/hash、复用 P1.8 launcher/Jobs/journal、真实 generated Pack → calibrated paired Trial、真实 Chrome、packed lifecycle 与零模型表面 | 真实 provider/用户纠正改善率、陌生用户可用性与多日 soak |
| Exact Candidate Retention Gate | `implemented`（P1.11） | [P1.11 证据](evidence/p1-11-exact-retention-gate.zh.md)：一个 source run + 一个 prior Case Pack、零 proposer、retained/regressed/incomplete、篡改/`SIGKILL`、packed lifecycle | 多个独立真实旧能力 Case、真实 provider Candidate 遗忘率、成为 release gate 前的成本/误阻塞数据 |
| Retention 自动晋升门 | `implemented`（P1.12） | [P1.12 证据](evidence/p1-12-opt-in-retention-auto-promotion-gate.zh.md)：静态 roots、missing/incomplete/regressed/tamper/conflict fail closed、真实 retained → supervisor auto promote、crash recheck、KV Cache/packed config | 真实 provider 遗忘率、误阻塞率、多个 prior Pack 冲突/过期策略与陌生用户配置数据 |
| Automatic Retention Target | `implemented`（P1.13） | [P1.13 证据](evidence/p1-13-automatic-retention-target.zh.md)：每 Skill 一个 static exact Target、native Jobs、自动 retained→promote / regressed→review、human/cost gate、不确定执行不重试、KV Cache/packed config | 多 prior Pack 语义、真实 provider 单位成本/净收益、陌生用户配置与多日 soak |
| Automatic Feedback Shadow | `implemented`（P1.14，默认关闭） | [P1.14 证据](evidence/p1-14-automatic-feedback-shadow.zh.md)：明确纠错 + 唯一 static exact Target、私有 Draft、一次 proposer、真实 assembled Shadow、自动 Retention→future Generation、`proposal-pending` 不重试、完整请求相等与 packed config | 真实纠正改善率/误晋升率/单位成本、多 Skill 歧义率、陌生用户配置与生产多日 soak |
| Automatic Evolution Budget | `implemented`（P1.15，随 P1.14/P1.16 默认关闭） | [P1.15 证据](evidence/p1-15-automatic-evolution-budget.zh.md)：每 Target 默认 1/日、付费边界前 `0600` 原子预留、幂等/重启/UTC rollover、损坏与 symlink fail closed、Commands/Web bounded 用量、真实 DSH 自动链路 | 真实 provider 单位成本、长期 cap 命中率、陌生用户配置与生产多日 soak |
| Automatic Evaluator Draft | `implemented`（P1.16，默认关闭） | [P1.16 证据](evidence/p1-16-automatic-evaluator-draft.zh.md)：明确纠正 + 唯一静态 Skill、日预算先行、private inactive Draft、`SIGKILL` 后付费请求不重试、64 轮请求等价、真实 Chrome 与 packed lifecycle | 真实 provider qualified/semantic-rejection/净收益、陌生用户配置与生产多日 soak；qualification/Shadow 仍需人工，P1.17 可合并为一次确认 |
| 人工 Qualify-and-Shadow | `implemented`（P1.17） | [P1.17 证据](evidence/p1-17-human-approved-qualify-and-shadow.zh.md)：一个可取消确认、qualification 失败零 proposer、qualification 后中断可重试、合并异步待办计数、Commands/Remote/Web 与真实 DSH 纵向链路 | 真实 provider outcome、陌生用户两步对一步的完成时长/误操作与多日恢复数据 |
| 每 Skill 单未决自动进化门 | `implemented`（P1.18） | [P1.18 证据](evidence/p1-18-per-skill-automatic-inflight-gate.zh.md)：Draft/Shadow/Review 三态权威、预算前 fail closed、同 Signal crash reentry、日 cap=2 下两条真实 Feedback 仍只有 `author → proposer`、零模型表面 | 真实 provider burst correction、review completion time/queue depth、单位成本与生产多日单 resident 数据 |
| 自动模糊审查过期处置 | `implemented`（P1.19） | [P1.19 证据](evidence/p1-19-automatic-ambiguous-review-expiry.zh.md)：automatic provenance、默认 168 小时、durable rejection、人工/promote/未激活反例、真实 DSH 先清理再 proposer、零模型表面 | 真实 review-age 分布、自动关闭误差、review-rate/accept-rate 与默认窗口校准 |
| 自动审阅窗口可见性 | `implemented`（P1.20） | [P1.20 证据](evidence/p1-20-automatic-review-window-visibility.zh.md)：host 派生 exact 时间与触发语义、Commands/Web 一致、详情显式刷新、stale 安全失败、真实 Chrome 0 error、零模型表面 | 陌生用户理解率/处理时长、真实 review-age 分布与默认窗口校准 |
| 单机常驻和崩溃恢复 | `implemented`（P0B） | 四个 release `SIGKILL` 边界；[P0B.2a](evidence/p0b-2a-durable-shadow-resume.zh.md)；[P0B.2b](evidence/p0b-2b-resident-shadow-supervisor.zh.md) native Jobs supervisor/关机恢复/重复扫描 | 生产多日 soak、真实磁盘耗尽与更多机器数据 |
| `dsh-software-delivery` | `implemented`（P2A.1 + P2B.1 + P2C.1–P2C.3 + P2D.1 consumer） | [P2A.1](evidence/p2a-1-software-delivery-verifier.zh.md)：真实 Git/CLI/package；[P2B.1](evidence/p2b-1-native-goal-verified-completion.zh.md)：Goal/Bash/update_goal；[P2C.1](evidence/p2c-1-idempotent-draft-pr.zh.md)：exact push、create/reuse、不确定重试、ready 冲突；[P2C.2](evidence/p2c-2-exact-draft-check-gate.zh.md)：exact-head checks 三态门；[P2C.3](evidence/p2c-3-bounded-draft-check-wait.zh.md)：pending/missing→green 有界等待、timeout/cancel/head drift；[P2D.1](evidence/p2d-1-delivery-outcome-signal.zh.md)：Evolve 第二消费者；[P1.2](evidence/p1-2-counterfactual-canary.zh.md)：失败后的反事实消费 | fork/其他 forge、required-only/CI 日志诊断、真实开发任务数据 |
| `dsh-doctor` Runtime Readiness | `implemented` | [实现证据](evidence/dsh-doctor-runtime-readiness.zh.md)：三态分类、原生 Commands、真实 Loader、tarball add/dump-config/boot/remove、零模型表面 | 发布版本、陌生用户诊断成功率；启动前失败与外部 provider 不在首版范围 |
| `dsh-telegram` 单私聊 Agent Adapter | `implemented`（AS-1 首片） | [AS-1 证据](evidence/as-1-telegram-private-chat.zh.md)：exact route、真实 Loader/Agent Loop、Goal/Schedule turn routing、原生 Commands、Approval callback、429 有界重试、Storage 重启、tarball add/boot/remove、零模型表面 | 真实 Bot 多日 soak、移动端/公网故障、陌生安装与 Hermes paired benchmark |
| PA-1 Protected Action hard gate | `implemented` | [PA-1 证据](evidence/pa-1-protected-action-hard-gates.zh.md)：一个 test pack 聚合 auto-promotion、sealed secret/network、paid retry、Draft-only delivery、future-session rollback | 真实第三方插件、恶意仓库、非 macOS 隔离与明确部署策略对抗数据 |
| 其他个人助理、消息、内容、日程 Adapter | `planned` | Telegram 单私聊已提供首个最小形态 | 每次只选择一个具备独立需求和 outcome 的工作流验证；两个真实 Adapter 前不抽 Gateway |
| Web 控制面 | `implemented`（P0C.6 + UI-1 + P1.20） | 可删除 Bundle、生成式 Remote、全局侧栏入口；固定 DSH tarball 装配与真实浏览器 pause → 进程重启仍暂停 → resume；真实 Chrome 已完成 claim/evidence/limitations/diff → inactive approval 闭环和 automatic review window/open/eligible/stale 刷新，[证据](evidence/p1-20-automatic-review-window-visibility.zh.md) | 陌生用户可用性数据、分页/图形 diff；实时推送仅在证据显示需要时考虑 |
| TUI 控制面 | `planned` | Commands 已可用，尚无独立 TUI 必要性证据 | 先证明 Web/Commands 无法覆盖的高频场景 |

## 当前可以做什么

- 阅读三项目深度研究与 DSH 插件目录；
- 复用 `build-dsh-plugin` Skill 开发 cache-safe DSH 扩展；
- 运行 Shadow，验证候选越权、预算、active/Case Pack 完整性，以及 macOS 上的校准配对检查；
- 通过 host service 记录 inactive Generation，并在 exact Git tree 校验后为未来 Session 晋升或回滚；
- 使用 `shadow --resume` 继续 durable Candidate/Trial；不确定的付费 proposal 不自动重试；
- 配置 resident supervisor 后，由常驻 DSH 自动继续已落盘、无网络的 Candidate/Trial，并通过原生 Jobs 观察或取消；
- 通过 host-only `/evolve review` 查看 claim/files/case/cost、exact Git baseline → sealed Candidate 的 bounded diff 与固定 protected-effect 词法提示，reject 或批准为 inactive Generation；随后显式 promote/rollback future-session Generation，全程不产生模型请求；
- 安装 `dsh-evolve-web` Bundle，在没有 Workspace 或 Session 时从全局侧栏打开同一控制闭环；页面只在打开、刷新和动作后读取，不轮询、不增加模型 token；
- 通过 `/evolve pause|resume` 持久控制自动 resident recovery；普通 Session、显式 Shadow 和人工 review/release 不受影响；
- 对显式 allowlist 的 `SKILL.md` 小幅 append clear win 开启实验性自动晋升；未满足固定门的候选仍留在人工 inbox；
- 让 Evolve 异步采集 `complete_delivery` 的最小三态结果，并通过 `/evolve status` 查看全局与当前 active Generation 聚合；该路径零模型调用且不阻塞交付会话；
- 继续使用 DSH 原生逐消息反馈：带备注负反馈会异步形成仅含引用/version/Generation 的可撤回 Signal，并在 `/evolve status` 聚合；EvoForge 不复制 note、cwd、Prompt 或消息正文；
- 显式配置私有 `feedbackDraftRoot` 后，通过 `/evolve feedback` 选择一条仍有效且只调用一个 Generation Skill 的纠正，生成可删除、未评分的内容寻址 Case Draft；
- 对已有可信 Case Pack 覆盖的失败类型，显式把 exact 私有草稿用于一次付费 Shadow proposer 搜索；独立 evaluator 仍决定结果，当前 Session/active Skill 不变；
- 为常用 Skill 配置静态 Shadow Target 后，可在 Commands/Web 只选择 signal id 与 target id，明确确认一次付费/纠正外发并立即把同一 Shadow 提交到原生 Jobs；重复动作复用 durable run；
- 在任何 proposer 请求前独立或自动验证 Case Pack 能拒绝 known-bad、接受 known-correction；失准时保留报告并消耗 0 proposer token；
- 为每个 Automatic Feedback Target 设置 `maxAttemptsPerUtcDay` 和可选 `maxPendingReviewAgeHours`；`/evolve status` 与 Web 可读当日 used/limit/remaining，以及自动 review 的 exact 窗口/eligible 状态/下一条同 Skill Signal 触发语义；过期处置仍只在下一条 Signal 前发生，原会话和显式人工 Shadow 均不阻塞；
- 显式调用 `author-dsh-evolution-case`，把一个可复现新失败按 search/calibration/final-test 分区写成 Case Pack，并在 proposer 前做零模型校准；
- 对 allowlist 自动晋升版本，在匹配失败后异步复用原 Case Pack 做 exact parent-vs-Candidate canary；只有可归因回归才回滚 future Session，模糊证据留待 review；
- 在真实 DSH Agent 上让 root/resume/child 固定各自 Generation；pin 或 Git 完整性失败时原生会话继续；
- 审查报告 Schema 的实际 JSON 输出。
- 通过 `software-delivery` Skill 使用原生 Goal/Shell 完成隔离开发；可用 `complete_delivery` 原子验证 exact Goal/commit/check、可选幂等发布 GitHub Draft PR，并可选择 exact-head 远端 checks 全绿后才调用原生完成，也可用 standalone CLI 生成三态结果。
- 安装 `dsh-doctor` 后用 `/doctor` 一次性查看当前 required plugins 和全部 enabled failures；结果只读、零模型 token，卸载后不留 Bundle 配置。
- 显式配置一个 Bot token 环境变量、exact private chat/user 与稳定 Agent `sessionId` 后，用
  `dsh-telegram` 在 Telegram 继续同一 Agent；原生 Commands/Approval/Goal/Schedule 均复用现有
  DSH seam，`/telegram` 可查看 delivery 状态，插件不增加模型 token。

## 当前不能做什么

- 不能把 P0C Commands/Web 闭环当作已验证的完整控制产品；已有受限逐行 diff 和保守词法影响提示，但后者不是语义安全证明，也尚无陌生用户 approve/promote/rollback 可用性数据、capability/权限差异审计或分页/折叠；
- 不能把 P1.1–P1.20/P2D.1 当作已验证的完整 bounded autonomy；已有反馈 intake、私有 Case Draft、既有 evaluator 下的 opt-in 自动 Shadow、全新失败的 opt-in 自动 inactive Evaluator Draft、人工 Qualify-and-Shadow、每 Skill 单未决门、模糊审查有界过期及窗口可见性、持久日预算、proposer 前校准、单 prior Target 自动 Retention 与反事实自动回滚，但没有默认后台 author 或自动 evaluator qualification，也无真实 provider、真实任务长期误晋升、误回滚、遗忘和 review-rate 数据；
- 不能把 P2A–P2D 当作完整跨 forge 自动交付：受验证动作不是全局 Goal 拦截，原生直接完成仍可用；Draft PR 只支持 GitHub.com 同仓分支；可选门可在一次 active Tool 调用内有界等待全部 rollup checks，但不实现 required-only 规则、CI 日志诊断或后台 watcher；standalone CLI 也不是运行不可信 checks 的安全沙箱；
- 不能把公开的确定性示例当作真实 DSH 工作流已经改善；
- `shadow` 不执行任意模型生成代码；assembled lane 会运行真实 DSH，但 Candidate 仍只作为 Skill 数据选择受限的可信 evaluator 行为；
- Exact/Automatic Retention 已能检查一个静态 prior Case Pack，但不能据此声称完整抗遗忘、完整持续进化、生产级多日可靠性、任意外部效果 crash-resume 或优于 Hermes；
- 不能把 `dsh-telegram` 当作生产消息平台或通用 Gateway：尚未跑真实 Bot 多日 soak、陌生用户安装
  或 Hermes paired benchmark；transport 不确定与 crash-in-send 只会标为 `uncertain`，不会盲重试，
  也不能撤回已经发送的消息；
- 不能作为生产依赖安装。

P0B 的本地实现门已通过；P0C.1–P0C.6 已形成含 exact bounded diff、protected-effect 词法提示、零模型调用和真实 DSH Web 入口的人工闭环；P1.1 已增加默认关闭、可解释、崩溃可恢复的最窄自动晋升。P2A–P2C.3 已把真实 Git/local checks/Draft PR/exact-head remote checks 与有界零模型等待绑定到一个原生 Goal 的受验证完成路径；P2D.1 已让 Evolve 成为不阻塞、零模型表面的第二消费者；P1.2 已用原 Case Pack 和 exact Git parent/Candidate 实现可归因自动回滚；P1.3/P1.4 已把明确纠正保存为私有、未评分 Case Draft；P1.5 已让 exact 草稿只引导 proposer，由既有可信 Case Pack 独立裁判；P1.6 已把 evaluator 方向校准提前到 proposer 之前；P1.7 已提供不进入 runtime surface 的显式 authoring Skill；P1.8/P1.14 分别提供逐次显式或部署策略授权的静态 Target Shadow，P1.15 用 crash-safe 日预算限制自动尝试；P1.9 把全新失败收敛为私有 inactive Evaluator Draft，并把 exact-hash 人工语义审查与真实 DSH sealed qualification 分开；P1.16 可按静态策略自动生成该 inactive Draft；P1.17 允许人工在一次明确付费披露中把 qualification 与成功后的 Shadow 合并；P1.18 又在预算前复用 Draft/Shadow/Review 事实，避免同一 Skill 的重复自动请求；P1.19 只对过期的 automatic `review` 复用 durable rejection，防止无人审批永久停学；P1.20 再把 exact 窗口与唯一触发条件投影给 Commands/Web，不新建 timer 或状态。上述能力不自动 qualification，也不会把模糊候选晋升；原会话均不等待。AS-1 首片也已由 `dsh-telegram` 实现，但仍只到自动化 `implemented`。下一步应收集独立陌生作者、真实 provider/任务 outcome、纠正改善率与真实 Bot/Hermes paired 数据，而不是扩大成新 Memory/Signal/Workflow/Gateway 平台。P0C 陌生用户可用性和生产多日 soak 继续作为证据积累，不能被短时自动化测试替代。
