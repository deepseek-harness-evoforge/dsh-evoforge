# EvoForge 开发路线图

> 状态：P0A–P1.8 已实现（含 P0C.6 Web 控制面）；P2A.1 验证、P2B.1 Goal 完成、P2C.1 Draft PR、P2C.2 exact checks 门与 P2D.1 Outcome 第二消费者已实现

## 当前状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| R0 上游与市场研究 | 完成 | DSH、171 插件、Claude Code Rev、Hermes、公开自进化项目报告 |
| R1 产品边界 | 完成 | Requirements、CONTEXT、产品架构、ADR、插件目录和接口规范 |
| R2 开源仓库就绪 | 完成 | [公共仓库](https://github.com/deepseek-harness-evoforge/dsh-evoforge)、MIT、贡献/安全文档与 Linux CI；macOS CI 在独立 Draft PR 验证 |
| P0A Shadow evaluator | 本地退出门通过 | 安全门、macOS Sealed Trial、真实 DSH bridge、3/3 公开产品 fixture 与[本地未见首测](evidence/p0a-8-private-heldout.zh.md)均转绿；真实 provider 与第三方独立复跑仍属更高等级证据 |
| P0B Local Continuity | implemented | P0B.1 release kernel、P0B.2a durable resume 与 P0B.2b resident supervisor 已通过本地/pinned DSH 测试；生产多日 soak 仍属发布前证据 |
| P0C Human Control | Commands + Web 闭环、verified bounded diff 与 lexical effect projection implemented；陌生用户可用性门待验证 | P0C.1 release、P0C.2 review → inactive Generation、P0C.3 durable pause/resume、P0C.4 exact Git diff preview、P0C.5 protected-effect 词法提示、P0C.6 真实 DSH Web/RPC/跨重启控制已通过测试 |
| P1 Bounded Autonomy | P1.1–P1.8 implemented；P2D.1 信号已接通 | 默认关闭的 allowlist + append-only policy、交付 outcome、显式反馈 intake、私有 Case Draft、既有 Case Pack 下的反馈引导 Shadow、静态 Target 的显式后台启动、proposer 前零模型校准、显式 evaluator authoring Skill、exact parent/Candidate 反事实 canary、pointer-safe 自动回滚均已通过测试；全新失败自动 evaluator 与真实任务长期率待验证 |
| P2 Software Delivery | P2A.1 + P2B.1 + P2C.1–P2C.2 + P2D.1 consumer implemented | linked worktree/commit/check、原生 Bash policy → exact push/Draft PR → 可选 exact-head 远端 checks 门 → `update_goal`，并由 Evolve 异步记录最小三态信号；pinned DSH Agent/ToolRuntime/Storage 与 package 已测 |

## P0A — 先证明会判断

交付：离线 `dsh-evolve shadow <skill-dir>`，只读 active Skill。

- 一个真实软件开发 Skill；
- 3–5 个 deterministic reproduction cases；
- 相互隔离的 search、selection、final-test；
- 一个已知坏 Candidate 和至少一个真实纠正；
- 最小 patch proposer；只有净收益不足时才试私有 GEPA adapter；
- 报告 claim、diff、逐 case 结果、成本和限制，不做激活。

退出条件：稳定拒绝坏 Candidate，并至少有一个改善通过未参与搜索的 final-test。否则停止，不建设在线发布底座。

详细测试接缝、报告 Schema、case 隔离和人工边界见 [P0A Shadow 契约](architecture/p0a-shadow-contract.zh.md)。

## P0B — Local Continuity 与 Release Safety

进入条件：P0A 通过。

- immutable Generation manifest；
- Session sidecar pin，resume/fork/child 保持 Generation；
- future-session-only active pointer；
- crash injection、幂等恢复和精确 rollback；
- 完整 composition fingerprint；
- 不生成外部不可逆效果。

P0B.1 已完成：Generation/active pointer/Session pin、exact Git Skill Provider、
future-session-only promotion/rollback、四个 release `SIGKILL` 边界，以及删除插件后
原生 Session/Goal 恢复。证据见 [P0B.1](evidence/p0b-1-generation-release-kernel.zh.md)。

P0B.2a 已完成：一个 run-local durable journal 在付费 proposal 前记录 intent；
不确定结果不自动重试；已落盘 Candidate 在 `SIGKILL` 后只重跑无网络 Sealed Trial；
并发 runner 被 owner lock 拒绝。证据见 [P0B.2a](evidence/p0b-2a-durable-shadow-resume.zh.md)。

P0B.2b 已完成：可选 supervisor 在 DSH 生命周期内扫描显式 run roots，只把 durable、
无网络的 Candidate/Trial 重新提交到原生 Jobs；关机取消完整 Trial 进程组，损坏 run 隔离，
重复扫描不重复执行。Journal 是事实源，Job 不是。证据见
[P0B.2b](evidence/p0b-2b-resident-shadow-supervisor.zh.md)与 [ADR-0009](adr/0009-journal-authority-native-jobs-observability.md)。

退出条件：所有注入崩溃点无半激活、无重复效果；活动 Session 不漂移；卸载后原生 DSH 可恢复。

## P0C — 可充分交互的人工闭环

- `/evolve status | review | promote | rollback | pause | resume`；
- host view 显示 claim、diff、case、成本、缓存、权限和 rollback target；
- review inbox 聚合、静默、可过期；原会话不等待；
- P0C 所有激活仍由人工决定。

P0C.1 已完成：可选 DSH Commands surface 提供 `/evolve status`、完整 content-id
`promote` 和精确 `rollback`；命令不调用模型，当前 Session 不漂移，hot unload 自动
注销。证据见 [P0C.1](evidence/p0c-1-human-release-command.zh.md)。

P0C.2 已完成：`review` 从 owned Shadow evidence 投影 claim、changed files、case、成本、
理由和限制；reject durable，approve 只发布 deterministic owned Git ref 与 inactive
Generation，不动用户 branch/worktree/active pointer。显式 promote 仍是第二步。证据见
[P0C.2](evidence/p0c-2-review-to-inactive-generation.zh.md)与
[ADR-0010](adr/0010-approved-candidates-use-owned-git-refs.md)。

P0C.3 已完成：`pause` 先持久化再停止 resident recovery，重启保持；`resume` 先持久化
再立即唤醒 journal discovery。普通 Session、显式 Shadow、人工 review/release 不被暂停。
证据见 [P0C.3](evidence/p0c-3-durable-resident-pause-resume.zh.md)。

P0C.4 已完成：review detail 复用 publication 的 exact Git baseline 和 Candidate whole-tree
验证，展示最多 16 KiB 的 control-safe diff；截断会报告完整字节数。它不读取漂移 worktree，
不持久化第二份 patch，也不调用模型或改变 Session composition。证据见
[P0C.4](evidence/p0c-4-verified-diff-preview.zh.md)与
[ADR-0021](adr/0021-review-diff-reuses-publication-baseline.md)。

P0C.5 已完成：同一 exact baseline/Candidate 变更会产生固定版本的 host-only protected-effect
词法提示，并与 P1.1 自动晋升复用一个 detector。它涵盖 artifact scope、凭据、破坏性动作、
消息/日程、网络、付费、权限、特权工具、生产变更和重写指令；否定句仍提示，未命中也不构成
安全证明，DSH Approval 继续权威。证据见
[P0C.5](evidence/p0c-5-protected-effect-projection.zh.md)与
[ADR-0024](adr/0024-review-effects-are-conservative-host-projections.md)。

P0C.6 已完成：独立 `dsh-evolve-web` Bundle 把结构化、bounded 的同一权威 host 状态接到
DSH 原生 Web 全局侧栏；无需 Workspace 或 Session。页面只在打开、刷新和动作后读取，无后台
轮询，不注册模型可见表面。固定 DSH revision 已通过 tarball 装配、生成式 RPC、真实浏览器
pause、进程重启保持 pause、resume 与零页面错误验收。批准仍只发布 inactive Generation，晋升
保持第二个动作。证据见 [P0C.6](evidence/p0c-6-web-control-plane.zh.md)与
[ADR-0025](adr/0025-web-is-a-thin-kv-safe-adapter.md)。

P0C 剩余的是退出证据：由不了解内部实现的用户在 Web 完成一次查看、审批、晋升和回滚，测量
控制时延与误操作。只有真实使用数据证明需要时，才增加实时推送、分页/图形 diff 或 TUI；不提取
第二套 Control Center、状态库或工作流概念。

退出条件：不了解内部实现的用户可以在一次查看中解释“改了什么、凭什么更好、有什么风险、怎么撤销”。

## P1 — 极窄自动晋升

- 仅 project-scoped、owned、纯指令且权限效果不变的 Candidate；
- deterministic clear win、独立 final-test、rollback rehearsal；
- future-session canary；可重放反事实证明回归时自动 rollback；
- 代码、工具、权限和外部动作继续只到 Draft PR/review。

P1.1 已完成：`autoPromote.skills` 显式 opt-in；只接受 exact baseline、assembled
composition stable、sealed clear win、全部 checks、Trial≥4 和 ≤2 KiB 单一 `SKILL.md`
append。protected-effect 或任何模糊证据留在人工 inbox。Automatic actor 先 durable，
崩溃后可完成 future-session promotion。证据见
[P1.1](evidence/p1-1-opt-in-clear-instruction-auto-promotion.zh.md)与
[ADR-0011](adr/0011-automatic-promotion-is-an-opt-in-clear-instruction-policy.md)。

P2D.1 已接通真实 Software Delivery outcome：观察最终 `tools/result`，关联 Session pin，按
Session + callId 幂等保存最多 1000 条最小三态记录，并只在 host `/evolve status` 聚合。
单次业务失败不回滚。证据见 [P2D.1](evidence/p2d-1-delivery-outcome-signal.zh.md)与
[ADR-0015](adr/0015-delivery-outcomes-are-derived-signals.md)。

P1.2 已完成最窄反事实闭环：匹配失败只触发异步复测；runner 校验原 Shadow run、Case Pack
hash/evaluator epoch、exact Git parent/Candidate 和 reviewed content hash，用同一个 calibrated
Sealed Trial 比较。只有 parent pass / Candidate fail 且 active pointer 未变化才自动 rollback
future Session；Candidate pass 保持，模糊或漂移进入 review。它复用 resident supervisor 与原生
Jobs，提案模型调用为 0，并用 run-local journal 恢复 pointer write 前后崩溃。证据见
[P1.2](evidence/p1-2-counterfactual-canary.zh.md)与
[ADR-0016](adr/0016-rollback-requires-counterfactual-canary.md)。

P1.3 已完成最小显式反馈入口：复用 DSH 原生逐消息 rating/note 与 durable
`domain/changed`；仅带备注的当前负反馈形成 reference-only、可撤回、限量的派生 Signal，
`/evolve status` 只显示 host 聚合。note、note hash、cwd、Prompt、Transcript 和消息正文均不
进入 EvoForge；不生成 Candidate、不调用模型、不触发 release。证据见
[P1.3](evidence/p1-3-explicit-feedback-intake.zh.md)与
[ADR-0017](adr/0017-explicit-feedback-stays-reference-only.md)。

P1.4 已完成最窄授权复制：只有配置私有 `feedbackDraftRoot` 且用户逐条执行
`/evolve feedback <id> draft <skill>`，系统才重新核对当前 feedback version、Session lifecycle、
pinned Generation、exact Git Skill 与单一显式 invocation，并保存不含 assistant/Tool/Skill body 的
内容寻址 Case Draft。草稿幂等、权限私有、无模型调用，也没有 replay score 或 Candidate。证据见
[P1.4](evidence/p1-4-private-feedback-case-draft.zh.md)与
[ADR-0018](adr/0018-feedback-case-drafts-require-explicit-private-copy.md)。

P1.5 已完成最窄可用反馈闭环：用户显式执行
`shadow ... --feedback-draft <private-draft.json>` 后，草稿只作为 proposer 的不可信搜索证据；运行
前验证私有文件、内容 id、目标 Skill 和 whole-Skill content hash，运行中仍由既有校准 Case Pack
独立完成 baseline/Candidate paired Trial。用户文本和 correction 不作为输入字段直接复制，新增的
durable 字段只有草稿 id 与私有恢复路径；proposer 回显仍可能随 Candidate/claim 持久化。命令显式授权本次可能付费的请求及反馈外发；正常 Session 与后台
恢复不增加 proposer 调用。证据见 [P1.5](evidence/p1-5-feedback-guided-shadow.zh.md)与
[ADR-0019](adr/0019-feedback-guides-search-not-evaluation.md)。

P1.6 已把 deterministic gate 放到模型之前：`dsh-evolve calibrate` 只运行 known-bad 与
known-correction，写入零模型调用报告；完整 Shadow 也先完成相同 preflight，方向不对时 provider
request count 为 0。成功 Shadow 仍只有四次 Trial（校准 2 + baseline/Candidate 2），没有新增平台、
Service 或 journal Schema。证据见
[P1.6](evidence/p1-6-preproposal-case-pack-calibration.zh.md)与
[ADR-0020](adr/0020-calibrate-case-packs-before-proposals.md)。

P1.7 提供显式、非隐式注入的
[`author-dsh-evolution-case`](../skills/author-dsh-evolution-case/SKILL.md)：一次只把一个可复现新失败
写成独立 search/calibration/final-test 分区，先 red/negative controls/correction，再复用零模型
`calibrate` 与现有 Sealed Trial。它不自动生成 grader、不进入 DSH runtime 模型表面。证据见
[P1.7](evidence/p1-7-evaluator-authoring-skill.zh.md)与
[ADR-0023](adr/0023-evaluator-authoring-is-an-explicit-skill.md)。

P1.7 已用一个既有 Pack 未覆盖的“进度汇报被误当完成”失败完成首次 keyless 前向测试：red
evaluator、两个 negative control、零模型校准、一次 bounded Shadow 与可回滚 Skill 晋升均成立。

P1.8 已把现有 Signal → Draft → Shadow 从手工路径拼接收敛为一个显式 host 动作。运维只配置
少量静态 Target，把公开 id 绑定 exact Skill、已校准 Case Pack 和 supervisor run root；Commands
与 Web 只提交 signal id + target id。每次动作明确授权一次可能付费的 proposer 和受限纠正外发，
立即返回并以原生 Jobs 观察；相同内容复用 launch id 与 run journal。它不自动生成 evaluator、
不自动晋升、不阻塞原会话，也不改变模型表面。证据见
[P1.8](evidence/p1-8-explicit-feedback-shadow-launch.zh.md)与
[ADR-0026](adr/0026-feedback-shadow-launch-is-explicit-and-target-bound.md)。

P1 剩余：由独立陌生作者复跑 authoring workflow，并测量既有可信 Case Pack 下真实
provider/用户纠正的改善率；继续收集真实开发任务的 false promotion、false rollback、review rate、
返工减少和多日常驻证据。P1.1–P1.8/P2D.1 不作
完整退出声明。

退出条件：真实 Shadow/Canary 数据证明 false promotion、false rollback、review rate 和每次减少返工的成本在预声明预算内。

## P2 — Software Delivery 产品化

- 原生 Goal 到 worktree、仓库规范、测试、diff、commit、Draft PR；
- Completion result 只保留 passed、failed、unknown 和 artifact reference；
- 作为独立插件可在关闭 Evolve 时使用；
- 为 Evolve 提供真实 outcome adapter，不反向依赖 Evolve。

P2A.1 已完成最小独立纵切：`dsh-software-delivery` 注册一个稳定、按需加载的原生 Skill；
`dsh-delivery verify` 对 linked worktree、named branch、exact base/HEAD、clean tree 与声明的
exact-argv checks 生成三态 JSON 和 Git commit artifact。它不新增 Tool/system prompt，
不依赖 Evolve，并通过 pinned DSH Agent、真实 Git、packed install/remove 与 built CLI。
证据见 [P2A.1](evidence/p2a-1-software-delivery-verifier.zh.md)与
[ADR-0012](adr/0012-software-delivery-starts-with-skill-and-verifier.md)。

P2B.1 增加一个稳定 `complete_delivery` Tool。它先核对 exact Goal id/revision 与 Git 状态，
再通过已有原生 `bash/pwsh` Tool 执行 checks，只有 `passed` 才嵌套调用原生 `update_goal`
完成同一个 Goal。失败、超时、policy 拒绝或仓库漂移都保持 Goal active。该动作不 monkey-patch
GoalService，不阻断人工直接完成，也不增加第二套 policy/state。证据见
[P2B.1](evidence/p2b-1-native-goal-verified-completion.zh.md)与
[ADR-0013](adr/0013-verified-completion-delegates-native-tools.md)。

P2C.1 在同一 `complete_delivery` Tool 增加可选 `draft_pr`，不增加第二个模型动作。它先检查
`gh auth`，把 exact verified commit 非强制推到 `origin` 同名 branch，查询 exact head/base 的
open PR：已存在且仍为 Draft 时复用；不存在时创建 Draft 并 read-after-write；ready PR 不降级。
创建响应不确定时保持 Goal active，重试先查远端事实，因此不会重复 PR，也不需要第二份 journal。
证据见 [P2C.1](evidence/p2c-1-idempotent-draft-pr.zh.md)与
[ADR-0014](adr/0014-remote-draft-pr-facts-are-idempotency-source.md)。

P2C.2 增加默认关闭的 host 配置 `requireDraftPrChecks`，仍不改变同一个 Tool 的 Schema。启用后
读取 exact PR `headRefOid/statusCheckRollup`：至少一项且全绿才完成 Goal；failed、pending、缺失、
不确定或 wrong-head 都保持 active。它每次调用只读一次，不建立 watcher/journal；显式重试复用
远端同一个 PR。证据见 [P2C.2](evidence/p2c-2-exact-draft-check-gate.zh.md)与
[ADR-0022](adr/0022-draft-checks-are-an-opt-in-completion-gate.md)。

P2D.1 已完成第二消费者：`dsh-evolve` 不反向侵入 Software Delivery，通过 DSH final
`tools/result` 异步记录 compact outcome，持久化/去重/重启失败不影响原 Goal 或 Tool。动态
状态只在 host Commands 可见，模型表面保持不变。它是 Learning Signal，不是 rollback 权限。

P2 剩余：用真实开发任务测量通过率、返工率、人工介入和 token/cache 成本。GitHub fork/其他
forge、required-only 规则、CI 日志诊断与自动等待只在真实需求数据证明后扩展。全局拦截所有
Goal transition 不在计划内，除非真实误完成数据证明原子动作不足。

## P3 — 一个通用助理场景

从消息、日程、内容或个人助理中只选一个已有高频需求的工作流。要求外部效果边界、审批、幂等与 outcome evaluator 先于实现。成功后再决定下一个 Adapter。

## Future — High Availability

只有单机运行数据证明 Local Continuity 有价值，并且用户提出明确 SLO 与多个故障域后，才设计多实例选主、故障转移和共享状态。该阶段不能以“常驻进程”冒充完成。

## 不随阶段增长的硬约束

- DSH 是唯一 Runtime；Goal 是唯一长期目标概念。
- KV Cache 是所有插件第一优先级；UI 和进化状态留在 host plane。
- 新能力通过 upstream-fixed test，不承接 DSH Core Defect。
- 每次只增加能独立解释的用户结果；共享 seam 需要两个真实 Adapter。
- Protected Action 不因自治程度提高而自动获得授权。

每个阶段的完成声明还必须遵守 [Hermes 上位目标验收记分卡](architecture/hermes-replacement-scorecard.zh.md)：代码和测试只能证明 `implemented`；没有故障注入、未见 case 和 paired benchmark 时不能写成 `verified` 或“优于 Hermes”。

## 当前外部准备项

无。公共仓库、GitHub CLI 与 SSH push 已验证。首包固定为 `dsh-evolve`，许可证为 MIT；项目所有者已授权按 P0A 契约自主实现和验证。
