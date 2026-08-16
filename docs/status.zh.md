# 当前实现状态

> 更新日期：2026-08-16

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
| Capability Generation 与 Session pin | `implemented`（P0B.1） | [P0B.1 证据](evidence/p0b-1-generation-release-kernel.zh.md)、真实 DSH Storage/Agent/Skill 测试 | 第三方复跑、更多 DSH 版本与长会话 cache 指标 |
| Git Skill 晋升与回滚内核 | `implemented`（host service + P0C Commands） | exact Git gate、future-session pointer、live Session 不漂移；[P0C.1](evidence/p0c-1-human-release-command.zh.md) 与 [P0C.2](evidence/p0c-2-review-to-inactive-generation.zh.md) | P1 自动晋升与真实 canary 数据 |
| 异步人工复核 | `implemented`（P0C.2） | claim/files/case/cost/限制 projection；reject durable；approve 生成 inactive Generation；真实 Commands/Agent 零模型调用且不阻塞原会话 | 逐行 diff viewer 与真实用户可用性数据 |
| Resident pause/resume | `implemented`（P0C.3） | [P0C.3](evidence/p0c-3-durable-resident-pause-resume.zh.md)：Storage 重启、release pointer 保持、活动 Trial 取消/resume 重发现、真实 Commands/Agent 零模型调用 | 生产多日 soak 与真实用户控制时延 |
| 极窄纯指令自动晋升 | `implemented`（P1.1，默认关闭） | [P1.1](evidence/p1-1-opt-in-clear-instruction-auto-promotion.zh.md)：allowlist、append-only、protected-effect gate、durable actor、崩溃续晋升、真实 future Session E2E | 长期 false-promotion 数据；P1.2 已补 canary/rollback |
| Delivery Outcome 第二消费者 | `implemented`（P2D.1） | [P2D.1](evidence/p2d-1-delivery-outcome-signal.zh.md)：真实 ToolRuntime/Storage、异步不阻塞、幂等/容量/重启、host-only 聚合、零模型请求 | 真实开发任务样本；P1.2 已补 active-vs-parent canary，单次失败仍不能直接回滚 |
| 反事实 Canary 与自动回滚 | `implemented`（P1.2，随 opt-in autoPromote） | [P1.2](evidence/p1-2-counterfactual-canary.zh.md)：exact Git parent/Candidate、原 Case Pack、macOS Sealed Trial、原生 Jobs、pointer race、crash recovery 与公开 CI | 真实任务 false-promotion/false-rollback/review rate 与多日 soak |
| 显式负反馈学习入口 | `implemented`（P1.3） | [P1.3](evidence/p1-3-explicit-feedback-intake.zh.md)：真实 DSH Message Feedback、reference-only/可撤回 Storage、host-only 聚合、重启/容量、零模型请求 | P1.4/P1.5 已提供显式私有 Draft 和反馈引导 Shadow；仍缺真实用户样本与长期候选改善率 |
| 私有 Feedback Case Draft | `implemented`（P1.4） | [P1.4](evidence/p1-4-private-feedback-case-draft.zh.md)：显式双重授权、exact feedback/Generation/Skill/content hash 归因、私有内容寻址落盘、幂等/撤回/歧义拒绝、零模型请求 | 全新失败仍需一个可信 deterministic evaluator |
| 反馈引导、独立评测 Shadow | `implemented`（P1.5） | [P1.5](evidence/p1-5-feedback-guided-shadow.zh.md)：私有草稿只进 proposer、existing Case Pack 独立判定、exact Skill gate、无证据原文复制、durable resume、macOS 55/55 | 真实 provider/用户纠正数据；全新失败 evaluator authoring 工作流 |
| 单机常驻和崩溃恢复 | `implemented`（P0B） | 四个 release `SIGKILL` 边界；[P0B.2a](evidence/p0b-2a-durable-shadow-resume.zh.md)；[P0B.2b](evidence/p0b-2b-resident-shadow-supervisor.zh.md) native Jobs supervisor/关机恢复/重复扫描 | 生产多日 soak、真实磁盘耗尽与更多机器数据 |
| `dsh-software-delivery` | `implemented`（P2A.1 + P2B.1 + P2C.1 + P2D.1 consumer） | [P2A.1](evidence/p2a-1-software-delivery-verifier.zh.md)：真实 Git/CLI/package；[P2B.1](evidence/p2b-1-native-goal-verified-completion.zh.md)：Goal/Bash/update_goal；[P2C.1](evidence/p2c-1-idempotent-draft-pr.zh.md)：exact push、create/reuse、不确定重试、ready 冲突；[P2D.1](evidence/p2d-1-delivery-outcome-signal.zh.md)：Evolve 第二消费者；[P1.2](evidence/p1-2-counterfactual-canary.zh.md)：失败后的反事实消费 | fork/其他 forge/CI 等待、真实开发任务数据 |
| 个人助理、消息、内容、日程插件 | `planned` | 仅产品范围 | 每次只选择一个高频工作流验证 |
| Web/TUI | `planned` | 交互原则已定义 | 权威 host projection、真实浏览器 E2E |

## 当前可以做什么

- 阅读三项目深度研究与 DSH 插件目录；
- 复用 `build-dsh-plugin` Skill 开发 cache-safe DSH 扩展；
- 运行 Shadow，验证候选越权、预算、active/Case Pack 完整性，以及 macOS 上的校准配对检查；
- 通过 host service 记录 inactive Generation，并在 exact Git tree 校验后为未来 Session 晋升或回滚；
- 使用 `shadow --resume` 继续 durable Candidate/Trial；不确定的付费 proposal 不自动重试；
- 配置 resident supervisor 后，由常驻 DSH 自动继续已落盘、无网络的 Candidate/Trial，并通过原生 Jobs 观察或取消；
- 通过 host-only `/evolve review` 查看 claim/files/case/cost，reject 或批准为 inactive Generation；随后显式 promote/rollback future-session Generation，全程不产生模型请求；
- 通过 `/evolve pause|resume` 持久控制自动 resident recovery；普通 Session、显式 Shadow 和人工 review/release 不受影响；
- 对显式 allowlist 的 `SKILL.md` 小幅 append clear win 开启实验性自动晋升；未满足固定门的候选仍留在人工 inbox；
- 让 Evolve 异步采集 `complete_delivery` 的最小三态结果，并通过 `/evolve status` 查看全局与当前 active Generation 聚合；该路径零模型调用且不阻塞交付会话；
- 继续使用 DSH 原生逐消息反馈：带备注负反馈会异步形成仅含引用/version/Generation 的可撤回 Signal，并在 `/evolve status` 聚合；EvoForge 不复制 note、cwd、Prompt 或消息正文；
- 显式配置私有 `feedbackDraftRoot` 后，通过 `/evolve feedback` 选择一条仍有效且只调用一个 Generation Skill 的纠正，生成可删除、未评分的内容寻址 Case Draft；
- 对已有可信 Case Pack 覆盖的失败类型，显式把 exact 私有草稿用于一次付费 Shadow proposer 搜索；独立 evaluator 仍决定结果，当前 Session/active Skill 不变；
- 对 allowlist 自动晋升版本，在匹配失败后异步复用原 Case Pack 做 exact parent-vs-Candidate canary；只有可归因回归才回滚 future Session，模糊证据留待 review；
- 在真实 DSH Agent 上让 root/resume/child 固定各自 Generation；pin 或 Git 完整性失败时原生会话继续；
- 审查报告 Schema 的实际 JSON 输出。
- 通过 `software-delivery` Skill 使用原生 Goal/Shell 完成隔离开发；可用 `complete_delivery` 原子验证 exact Goal/commit/check、可选幂等发布 GitHub Draft PR，并仅在全部通过时调用原生完成，也可用 standalone CLI 生成三态结果。

## 当前不能做什么

- 不能把 P0C 命令闭环当作已验证的完整控制产品；它尚无逐行 diff viewer 或真实用户可用性数据；
- 不能把 P1.1–P1.5/P2D.1 当作已验证的完整 bounded autonomy；已有反馈 intake、私有 Case Draft、既有 evaluator 下的反馈引导 Shadow 与反事实自动回滚，但全新失败仍没有自动 evaluator，也无真实任务长期误晋升、误回滚和 review-rate 数据；
- 不能把 P2A–P2D 当作完整跨 forge 自动交付：受验证动作不是全局 Goal 拦截，原生直接完成仍可用；Draft PR 只支持 GitHub.com 同仓分支，未等待远端 CI；standalone CLI 也不是运行不可信 checks 的安全沙箱；
- 不能把公开的确定性示例当作真实 DSH 工作流已经改善；
- `shadow` 不执行任意模型生成代码；assembled lane 会运行真实 DSH，但 Candidate 仍只作为 Skill 数据选择受限的可信 evaluator 行为；
- 不能声称完整持续进化、生产级多日可靠性、任意外部效果 crash-resume 或优于 Hermes；
- 不能作为生产依赖安装。

P0B 的本地实现门已通过；P0C.1–P0C.3 已形成零模型调用的人工闭环；P1.1 已增加默认关闭、可解释、崩溃可恢复的最窄自动晋升。P2A–P2C 已把真实 Git/check/Draft PR outcome 绑定到一个原生 Goal 的受验证完成路径；P2D.1 已让 Evolve 成为不阻塞、零模型表面的第二消费者；P1.2 已用原 Case Pack 和 exact Git parent/Candidate 实现可归因自动回滚；P1.3/P1.4 已把明确纠正保存为私有、未评分 Case Draft；P1.5 已让 exact 草稿在一次显式 Shadow 中只引导 proposer，由既有可信 Case Pack 独立裁判。下一步应收集真实 provider/纠正的改善率，并只为一个无法被现有 Case Pack 覆盖的高频失败验证最窄 evaluator authoring 工作流，而不是扩大成新 Memory/Signal/Workflow 平台。P0C 普通用户可用性和生产多日 soak 继续作为证据积累，不能被短时自动化测试替代。
