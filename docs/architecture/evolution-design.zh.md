# EvoForge 可证明自进化架构

> 更新日期：2026-08-21
> 当前状态：内部 Goal 经验到 exact Retention、future-Session Promotion Eligibility、失败 Outcome 触发的 sealed Canary evidence 和 expected-active Rollback Gate 活动纵切已实现；existing-Skill 调用时完整 Bundle、同一基线资格、Candidate 前 Holdout/Retention Envelope、protected whole-tree Candidate、结构准入、exact paired Holdout 与只从 authoritative improved Holdout 触发的 exact Retention 已实现。V4.42 已从最终 tarball 完成 existing-Skill Retention 的 DSH Web 权威展示；V4.43 已完成独立 existing-Skill Host/Command 发布门、持久人工决定、inactive Generation、同名 future-only Session 选择与显式回滚自动化。该门的 Control/Remote/Web、failed-Outcome Canary、长期 Outcome 归因、两套独立真实 provider 和 Hermes paired benchmark 尚未完成。

## 1. 用户结果

EvoForge 的自进化不是“自动改 prompt”，而是：

> DSH 从自己的真实 Goal 执行经验中发现重复能力缺口，形成一个完整、隔离的 Skill Candidate，用 Candidate 无法篡改的评测证据证明它对未见任务有益且没有破坏已有能力，然后只对未来 Session 原子晋升；后续结果恶化时可精确回滚。

用户只提供自然语言 Goal、材料、约束、权限和验收标准。系统不要求用户在开场选择任务类型、Agent、workflow、Skill、来源或路径。

## 2. 权威与非目标

DSH 是唯一 Agent Host，并持有 Workspace、Session、Goal、Schedule、Approval、Permission、Skill、Tool、Jobs 和持久化权威。`dsh-evolve` 只保存有界的派生证据和内容寻址制品。

本架构明确不建设：

- 第二套 Session、Goal、Agent Runtime、调度器、审批或 Memory 平台；
- 运行时外部 Skill 搜索、获取、下载、导入、安装或市场；
- ClawHub 或其他市场 workflow；
- 由用户、profile 或 operator 预选待进化 Skill；
- 用同一 Goal retry、使用次数、一次成功或模型自评冒充进化证据；
- 用 Git branch 表示运行时 Candidate 或 Generation。

Hermes、OpenClaw、HanaAgent、GEPA、EvoSkill、SkillHone、OpenSkill 和 DGM 只是设计期及 paired benchmark 的固定 revision 证据。

## 3. 三平面与双速闭环

### 3.1 执行面

当前 Session 使用创建时固定的 Capability Generation。原生 DSH Skill catalog 继续负责已安装能力的渐进加载；EvoForge 不添加另一个 Skill 选择器。

### 3.2 Candidate 面

Candidate 由 DSH 内部经验归纳而来，默认为 `inactive`、`quarantined`、`unevaluated`、`never-executed`。它可以提出完整 Skill Bundle，但无权读取 protected case、更改 evaluator、写入 active selection 或修改当前 Session。

### 3.3 Evaluation Governance Plane

治理面在 Candidate 生成前密封 admission、holdout 和可选 Retention 证据，持有 hard gate 和 release eligibility。Candidate proposer 不得担任最终裁判；隔离或证据无法证明时结果是 `incomplete` 或 `abstain`，不是通过。

### 3.4 双速

- **Fast Evolution Loop** 只记录可归因的 Gap、纠正、Outcome、成本、时延和回滚事实，不修改活动能力。
- **Slow Evolution Loop** 跨 Goal 聚合证据，形成 Opportunity、Candidate、Shadow、Retention、review、promotion 和后续 canary。

## 4. 当前内部证据链

```text
Natural-language Goal
  → native Skill catalog routing
  → verified Capability Gap
  → cross-Goal Skill Opportunity
  → pre-authoring Evidence Seal
  → quarantined whole-Skill Candidate
  → Candidate-independent Governance Envelope
  → deterministic Admission
  → exact-Candidate assembled Shadow
  → independent Retention
  → Review + inactive Generation
  → Host Promotion Eligibility
  → future-Session selection
  → failed durable Outcome
  → sealed counterfactual canary evidence
  → separate exact rollback authority
```

### 4.1 Capability Gap

`report_capability_gap` 是一个名称、描述、Schema 和顺序在 Session 内稳定的最小 Tool。Host 必须重验 exact Workspace/Session、active Goal、settled catalog 和能力确实不存在。模型说“不会”或一次失败不足以形成 Gap。

### 4.2 Skill Opportunity

`ExperienceDrivenSkillOpportunityDiscovery` 只从同一 Workspace 中至少两个不同 Goal 的 durable Gap 形成 Opportunity。Skill identity 来自 Gap 证据，不来自配置。Outcome 和纠正可以作为无因果的调查上下文，不能平白增加资格或改变排序。

### 4.3 Existing-Skill improvement

已安装 Skill 与缺失 Skill 分轨。只有同 Workspace、同 Skill 名、同 invocation-content hash 在至少两个不同 Goal 收到明确纠正，才会形成独立调查。局部 hash 不是完整 Skill package；Host 在每次原生调用边界封存完整目录 Bundle，并把每个 correction 的 immutable Session/invocation reference 逐一重验。全部引用必须指向同一个内容寻址 baseline，missing 等待，漂移、损坏、错配或多个 Bundle 均 invalid。至少四个不同 Goal 后，Host 再经官方 Message Feedback/Session Persistence 读取当前纠正与 exact durable Goal/请求，在 Candidate 调用前内容寻址密封 authoring/admission/holdout；第五个及以上额外保留 Retention。proposer 只得到 authoring，保护正文不进入 Remote/Web。Candidate-blind governance 在 proposer 前以两个独立调用分别形成 calibrated assembled Holdout 与可选 Retention Case Pack，每次只见一个 protected Goal；两套 hash 共同进入 exact Evaluation Envelope 和 Candidate 内容身份。受保护作者再生成完整继承 baseline 的 whole-tree Candidate，结构准入只确认 declared diff。随后独立 paired holdout 才在同一 assembled DSH Trial 中执行 exact baseline/Candidate 双树；Envelope 缺失或错配在 Trial 前失败关闭，只有 calibration、assembled、composition 与输入完整性全部成立，才给出 `improved/ambiguous/not-improved/regressed`，并始终无安装或发布权。

## 5. 生成前证据密封

`SkillEvaluationEvidenceVault` 从 exact Opportunity 快照中选取不重叠的独立 Goal：

- 少于四个 Goal：不调用模型，abstain；
- 四个 Goal：authoring、admission、holdout；
- 五个及以上 Goal：再保留一个 Candidate 不可见的 Retention 样本。

Evidence Seal 对 Opportunity 快照、角色分区和 author input digest 内容寻址。任何样本重用、路径重叠、symlink、内容漂移或候选先于密封均 fail closed。

## 6. Candidate 和治理包

Slow Loop author 只读 authoring 分区，不读 holdout、Retention、外部搜索结果或发布权限。Host 只接受 canonical text-only whole-Skill Bundle，校验路径、大小、文件类型和内容哈希后写入隔离、Workspace-scoped 的内容寻址存储。

`SkillEvaluationGovernance` 在 Candidate 不可见的边界中分别作者化 admission、holdout 和 Retention Case Pack，并先用零 proposer calibration 证明 evaluator 方向。候选 proposer 和治理作者为同一模型身份时，在预算和调用之前失败关闭。已 dispatch 但结果不可确定的付费调用持久化为 `uncertain`，不盲目重试。

## 7. Admission、Shadow 与 Retention

`SkillCandidateAdmission` 先执行不启动 DSH、不执行 Candidate、不调用模型、不使用网络的确定性检查。只有通过的 exact Candidate 才进入 `dshAssembled` Shadow。

Shadow 必须使用同一 DSH revision、任务、权限、预算和非目标 composition 对比 baseline/Candidate。缺失 Skill 路径的 baseline 只有 bound `subject.json`，不允许占位 `SKILL.md`；Candidate 侧才安装 exact Bundle。Shadow 不调用 proposer，不选 target，不读 Git 或网络。

promotable Shadow 在同一 DSH Jobs 任务中进入 `InternalSkillRetention`。Retention 重验 Envelope、Admission、Lineage、Shadow、Candidate tree、Case Pack、DSH revision、预算和 composition，持久得出 `retained`、`regressed` 或 `incomplete`。Retention 零 proposer，没有安装、激活或发布接口。

existing-Skill 不复用 capability-absent Shadow。`ExistingSkillCandidateAdmission` 先以 Host-only 结构检查给出 `qualified-for-holdout`；`ExistingSkillHoldoutEvaluation` 再重新解析 exact Admission、installed baseline、whole-tree Candidate 和 Candidate 内容身份已绑定的 Candidate-blind Envelope，把两个 `skill-tree` 交给同一 assembled DSH Trial。Envelope 缺失或错配在 Candidate 物化和 Trial 前失败关闭；运行前后重验三棵树、固定 DSH revision、calibration 和非目标 composition。付费 Trial dispatch 前写入 durable pending；重启时若结果未知则标为 uncertain，不盲重试。四象限 verdict 只进入后续 Retention 的证据输入，本身无 release authority。

## 8. Generation、Promotion 与 rollback

经复核的 Candidate 可形成 immutable、content-addressed、inactive `skill-bundle` Capability Generation。`FutureSessionPromotion` 是独立 Host authority，每次 Command/Web 晋升时都重新读取：

- approved Review；
- exact Generation artifact；
- Candidate Lineage；
- completed promotable Shadow；
- 唯一且身份一致的 terminal Retention。

missing 或 prepared 为 `waiting`；告警、歧义、谱系错配、`regressed`、`incomplete` 或 verdict/evidence 脱钩为 `blocked`；只有 exact `retained` 为 `eligible`。晋升只原子切换 Workspace 的 future-Session selection；已存在 Session 继续使用原 Generation。rollback 切回 exact parent 或 native DSH selection，不声称撤销已发生的外部效果。

## 9. Outcome 和反事实 canary

`DeliveryOutcomeMonitor` 只在 DSH Session durable checkpoint 之后，从 source-linked `complete_delivery` Tool call/result 投影有界 Outcome，并归属到该 Session 固定的 Generation。冷启动重放不重复执行 Tool 或外部效果。单个失败 Outcome 不能证明回归，也不能直接回滚。

反事实 canary 已实现为 `CounterfactualCanary` 深模块与原生 DSH `evolution` Job。当前活动合同是：

1. 只由精确归属到当前 active internal Candidate lineage 的失败 durable Outcome 触发；
2. 只重放该 Candidate 已密封、已校准的治理用例，不把真实失败 Goal 冒充成可重放的因果实验；
3. 比较 immutable pre-Candidate subject/Generation 与 exact active Candidate；
4. 运行前后重验 active pointer 未漂移；Promotion/rollback 仍只影响未来 Session，当前 Session pin 不变；
5. 只产生 durable `keep`/`review`/`rollback-eligible` 证据，不直接操作 release pointer；
6. 运行身份绑定 Workspace、Generation、Outcome、Candidate、Review、Retention、Admission、Envelope、Case Pack 和两侧 tree hash；
7. 执行中断、状态漂移或证据不完整均 fail closed，且已 dispatch 未观察到结果时不盲目重复付费调用；
8. 每 Workspace 复用现有评测 policy 的持久日预算；`keep` 后新的失败可继续监测，`review`/`rollback-eligible` 会停止该活动 Generation 的后续花费，等待独立 Host action。

`FutureSessionRollback` 是与 Canary 分离的唯一 Host mutation seam。显式人工回滚不依赖 Canary 配置；证据回滚必须带 exact Canary id，并重验唯一 terminal verdict、Workspace、active Generation 与 bounded evidence。两条路径都把观察到的 active id 传给 Generation Store，由 Store 在串行写临界区执行 expected-active compare；资格检查后的并发 pointer 变化会失败，不会误回滚另一个 Generation。Command、Remote、Web 不直接写 Store，Canary 继续无发布权。

这条路径不得复活 Git parent inference、静态 target、Feedback/Evaluator Draft、旧 canary journal 或候选自己判定回滚。

## 10. DSH Web 控制面

`dsh-evolve-web` 是一个零模型调用的 DSH Client Module。浏览器只读 Host 权威 Remote，不接收 Host path、protected Goal/Case、evaluator source、provider identity 或 Candidate proposal 正文。

当前已投影 Capability Map/Gap、Opportunity、Candidate、证据密封、治理作者状态、Admission、existing-Skill exact paired holdout、Shadow、Retention、Review、Generation、Promotion Eligibility、Outcome metrics、counterfactual Canary 与 rollback。paired holdout 视图显示 exact Candidate/Admission/Envelope、三棵树、双方结果、calibration/assembled/composition/integrity、model/token/cache 和无发布权；Canary 视图另显示 pointer 稳定，只有 terminal `rollback-eligible` 行提供 exact-id 回滚入口，仍需人工确认并由 Host 重验。页面刷新失败必须显式报错，保留最后一次成功证据；Host 恢复后重新读取权威状态。所有写操作调用 Host 同一权威接口，不在浏览器里实现另一套规则。

## 11. 持久化、恢复、权限与 Cache

- 证据和 Candidate 状态在可能的外部调用前持久化 intent，终态通过内容身份幂等重放；
- DSH Jobs 只负责当前进程的观察与取消，不是第二持久调度器；
- Candidate 和评测输出按内容寻址，冲突、篡改、根路径重叠或身份不一致均 fail closed；
- 代码、脚本、凭据、权限扩大、付费调用和外部副作用走 DSH Protected Action 或明确部署策略；
- Host/Web 进化状态不进入模型 prompt；动态能力只在新 Session 组合时固定，保护 KV Cache prefix。

## 12. 发布门禁

以下条件同时成立前，状态只能是 `implemented`，不是已完成的自进化：

- clean-profile tarball add/dump/boot/real-path/reload/dispose/remove 通过；
- Session/Goal 恢复、当前 Session pin、原子晋升与 exact rollback 通过；
- 真实 provider 下 admission/holdout/Retention/canary 和故障注入通过；
- 真实浏览器验证刷新、断连、恢复和控制操作；
- existing-Skill protected whole-tree author、Candidate、结构准入、exact paired Holdout 与独立 Retention 通过；独立 Canary/promotion/rollback 通过；
- 长期误晋升、负迁移、遗忘、重复外部效果、成本、时延、cache-read 和回滚指标达标；
- 相同任务、模型、权限和预算的 Hermes paired benchmark 证明声称的上位结果。

越权、评测泄漏、当前 Session 漂移、无法卸载或无法精确回滚任意一项都阻止 tag 和发布。

当前 exact Retention、Promotion Eligibility、Canary evidence、Rollback Gate、existing-Skill baseline qualification、correction evidence seal、exact paired Holdout、Candidate 前 Retention 治理与 exact Retention 评测见 [V4.26](../evidence/v4-26-exact-candidate-retention-execution.zh.md)、[V4.27](../evidence/v4-27-shadow-retention-web-projection.zh.md)、[V4.28](../evidence/v4-28-shadow-retention-real-browser.zh.md)、[V4.29](../evidence/v4-29-retention-promotion-eligibility.zh.md)、[V4.31](../evidence/v4-31-failed-outcome-counterfactual-canary.zh.md)、[V4.32](../evidence/v4-32-exact-canary-rollback-gate.zh.md)、[V4.34](../evidence/v4-34-existing-skill-baseline-qualification.zh.md)、[V4.35](../evidence/v4-35-existing-skill-correction-evidence-seal.zh.md)、[V4.39](../evidence/v4-39-existing-skill-exact-paired-holdout-evaluation.zh.md)、[V4.40](../evidence/v4-40-existing-skill-pre-candidate-retention-governance.zh.md) 和 [V4.41](../evidence/v4-41-existing-skill-exact-retention-evaluation.zh.md)。
