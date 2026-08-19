# ADR-0055：内部 Candidate 评测由 Opportunity-bound Envelope 决定

旧的 `candidateAdmissionTargets` 与 `candidateShadowTargets` 都要求部署者在 profile 中写死 exact
Workspace、Skill、baseline、Case Pack hash 和 run root。虽然路径与内容可校验，但部署者事实上在内部证据
形成 Opportunity 之前就决定了“进化哪个 Skill、用哪套评测”，这与自我发现的产品语义冲突；两套 target
还可能让 admission 与 holdout 指向不同的候选方向或重复样本。继续兼容这些字段会永久保留错误架构。

内部 whole-Skill Candidate 改用一个 Workspace 级 `candidateEvaluationPolicies`：配置只包含 policy id、
Workspace id、governance root 与 run root，不允许 Skill、baseline、Case Pack 或 Candidate selector。Host 从
Candidate 引用的当前 `SkillOpportunity` 重新发现并核对 exact Workspace、Skill、Gap ids 和 Goal count，然后只
读取 `governanceRoot/envelopes/<opportunity-id>`。严格 manifest 绑定 Opportunity 快照、baseline identity、
deterministic admission Case Pack hash 和不同的 assembled holdout Case Pack hash；三棵输入树与 manifest 必须是
exact real path，内容漂移、symlink、root overlap、相同 admission/holdout hash 或 Opportunity 不一致均 fail closed。

Envelope identity 对 policy 与全部绑定内容做内容寻址，并同时进入 durable admission state/result、
`SkillCandidateLineage` 和 assembled Shadow handoff。admission 只能产生 `qualified-for-shadow`，Shadow 必须重新解析
同一个当前 Opportunity 与 Envelope；二者都没有 install、activate、publish 或 promote 权限。显式纠正使用的
静态 `shadowTargets` 仍只属于 Feedback-guided Shadow，不得复用于内部 Candidate 评测。

这是有意的不兼容替换：旧配置字段和旧 lineage schema 不提供读取或翻译入口，避免错误目标继续静默生效。
代价是部署者必须迁移治理目录布局。当前决策只规定并实现治理包的消费、身份与隔离边界；它尚未证明
Evaluation Governance Plane 能从内部 Goal outcome、纠正、失败类和回归样本自主生成并封存合格 Envelope，
该能力必须在后续增量中单独实现和验证。

ADR-0056 进一步修正 baseline 语义：内部 Opportunity 来自 exact catalog miss，因此 v2 Envelope 必须绑定
`capability-absent` descriptor，不能包含占位 `SKILL.md`。v1 baseline tree 不再接受。
