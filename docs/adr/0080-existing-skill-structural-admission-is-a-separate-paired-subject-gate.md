# ADR-0080：现有 Skill 结构准入是独立的精确双树门禁

- 状态：Accepted
- 日期：2026-08-21

## 背景

V4.36 已生成完整继承 installed baseline 的 existing-Skill Candidate，但既有 `SkillEvaluationEnvelope` 与 `SkillCandidateAdmission` 从 subject、Case Pack 到提示词都严格绑定 `capability-absent` 新 Skill。把两条路径合并成可选字段会模糊“未安装 Skill”与“旧 Skill 完整树”的 baseline 语义，也容易让结构校验冒充效果评测。

## 决策

新增独立 `ExistingSkillCandidateAdmission`：

1. 公开入口只有 `evaluate(candidate)`、`scan(workspaceId?)` 和原生 Jobs 调度；配置仍只选择 Workspace 与治理/run roots，不选择 Skill、路径、Case 或 Candidate 方向；
2. Host 通过内容地址读取 exact `InstalledSkillBaselineBundle`、existing-Skill Candidate 整包和 governance-only evidence；proposer 不参与，也看不到 admission 样本；
3. 每次准入重算 baseline/Candidate canonical archive 与 tree，逐字比较完整文件集，并要求实际 changed/added/preserved/binary 计数与 Candidate 声明完全相等；删除、未声明 diff、非 `SKILL.md`/一层 `references/*.md` 差异、identity 或 evidence 漂移全部阻断；
4. exact baseline 与 Candidate 物化到隔离、内容寻址的同一运行证据中；state/result 原子持久化并加锁，terminal 结果幂等读取，依赖暂不可用的 `incomplete` 可由持久 Candidate 队列恢复；
5. 原生 DSH Jobs 是唯一调度/取消/观察面；Candidate repository 在整包落盘后通知调度器，启动时也从 DSH Storage 恢复全部 existing-Skill Candidate；
6. 通过结果只能是 `qualified-for-holdout`，证据明确 `candidateExecuted: false`、`evaluatorClass: host-structural`、`releaseAuthority: none`。它证明双树与 protected admission 身份完整，不证明任务效果改善；
7. DSH Web 通过 Host 权威投影单独显示 status/reason、baseline→Candidate tree、声明 diff 计数和 protected admission 摘要，不接收样本正文、Skill 内容、Host 路径或运行权限。

## 后果

- capability-absent 新 Skill 的 Envelope/Admission 保持单一语义；现有 Skill 不再伪装成“能力缺失”；
- 后续 assembled holdout 可直接消费已封存的 exact parent/Candidate pair，而不重新猜测 baseline 或重组 Candidate；
- 当前增量仍不是 paired effect evaluation。独立 assembled holdout、Retention、Canary、promotion、rollback 和真实 provider/browser 证据继续作为发布阻断门。
