# EvoForge 开发路线图

> 状态：P0A–P1.1 已实现；P2A.1 验证、P2B.1 Goal 完成与 P2C.1 Draft PR 已实现

## 当前状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| R0 上游与市场研究 | 完成 | DSH、171 插件、Claude Code Rev、Hermes、公开自进化项目报告 |
| R1 产品边界 | 完成 | Requirements、CONTEXT、产品架构、ADR、插件目录和接口规范 |
| R2 开源仓库就绪 | 完成 | [公共仓库](https://github.com/deepseek-harness-evoforge/dsh-evoforge)、MIT、贡献/安全文档与 Linux CI；macOS CI 在独立 Draft PR 验证 |
| P0A Shadow evaluator | 本地退出门通过 | 安全门、macOS Sealed Trial、真实 DSH bridge、3/3 公开产品 fixture 与[本地未见首测](evidence/p0a-8-private-heldout.zh.md)均转绿；真实 provider 与第三方独立复跑仍属更高等级证据 |
| P0B Local Continuity | implemented | P0B.1 release kernel、P0B.2a durable resume 与 P0B.2b resident supervisor 已通过本地/pinned DSH 测试；生产多日 soak 仍属发布前证据 |
| P0C Human Control | 命令闭环 implemented；可用性门待验证 | P0C.1 release、P0C.2 review → inactive Generation、P0C.3 durable pause/resume 已通过真实 Commands/Agent 测试 |
| P1 Bounded Autonomy | P1.1 implemented | 默认关闭的 allowlist + append-only clear-instruction policy 已通过 policy/crash/真实 DSH future-Session 测试；canary/自动回滚待完成 |
| P2 Software Delivery | P2A.1 + P2B.1 + P2C.1 implemented | linked worktree/commit/check、原生 Bash policy → exact push/Draft PR → `update_goal`、pinned DSH Agent 与 package；Evolve outcome 集成待完成 |

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

P0C 剩余的是退出证据：由不了解内部实现的用户完成一次查看、审批、暂停和回滚，测量
控制时延与误操作。逐行 diff viewer 只在该试验证明文件清单不足时再做，不预建通用
Control Center。

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

P1 剩余：future-session canary、真实 outcome monitor、阈值化自动 rollback，以及真实
provider 数据下的 false promotion/false rollback/review rate。P1.1 不作完整退出声明。

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

P2 剩余：由 `dsh-evolve` 作为第二消费者接入 outcome monitor；再用真实开发任务测量通过率、
返工率、人工介入和 token/cache 成本。GitHub fork/其他 forge/远端 CI 等待只在真实需求数据
证明后扩展。全局拦截所有 Goal transition 不在计划内，除非真实误完成数据证明原子动作不足。

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
