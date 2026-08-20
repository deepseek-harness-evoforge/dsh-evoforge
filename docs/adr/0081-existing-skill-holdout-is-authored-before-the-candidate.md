# ADR-0081：现有 Skill Holdout 必须在 Candidate 前独立形成

- 状态：Accepted
- 日期：2026-08-21

## 背景

existing-Skill 的 baseline 是一个已安装完整 Skill 树，不能复用 capability-absent 新 Skill 的 Evaluation Envelope。若等 Candidate 生成后才让治理作者形成 holdout，即使提示词声称隔离，也难以证明作者从未看到 Candidate、diff 或 claim；若让 proposer 同时生成测试，则 proposer 会兼任裁判。

## 决策

1. 新增独立 `ExistingSkillHoldoutGovernance`，只接收 exact Opportunity、Baseline Qualification、完整 sealed baseline、pre-Candidate Evidence Seal、proposer model identity hash 和唯一 protected holdout；输入不包含 Candidate、diff、claim 或发布方向。
2. proposer 与 holdout governance author 的模型身份必须不同；相同 identity 在付费预算和作者调用前阻断。
3. governance author 只生成完整 root `SKILL.md` known-correction 和 assembled DSH evaluator；Host 将 synthetic known-bad、known-correction 与 baseline 的其余 references/assets/binary 组装为完整 `skill-tree` Case Pack，并要求零 proposer 的 calibration 通过后原子安装内容寻址 Envelope。
4. 该治理在 `ExistingSkillCandidateAuthoring` 的同一原生 DSH Jobs 任务中先执行；holdout budget deferred、paid-call uncertain、校准失败或 identity 漂移都会在 proposer 预算和 Candidate 生成前 fail closed。已知结果幂等读取，未知付费结果不盲重试。
5. Candidate authoring state 与新 Candidate 的 authorship/content identity 都必须记录 exact Envelope id；只在 authoring state 留一个可替换 lookup tuple 不足以证明 Candidate 是在哪个生成前 Envelope 后方产生。历史上没有该字段的 Candidate 仍可读取，但不得进入 paired holdout。治理面和 Web 只投影 phase、exact baseline/evidence/Envelope identity、聚合成本、retry/failure 和无发布权，不下发保护样本、Skill 内容、evaluator、provider identity 或 Host path。
6. ready 只证明 Candidate 不可见的 assembled holdout 已独立形成并校准；Candidate 尚未执行，也没有 baseline/candidate 效果判决、Retention、Canary、晋升或发布权。

## 后果

- holdout 作者的候选不可见性由调用时序、输入 contract 和 model identity separation 共同保证，而不是依赖约定；
- Candidate 的内容地址随 pre-Candidate Envelope 改变，治理存储被替换或错配时不能静默改判；
- 后续 paired runner 可以消费 exact baseline、Candidate 和已封存 Case Pack，但必须另行产生真实 `skill-tree ↔ skill-tree` Trial 证据；
- capability-absent Evaluation Envelope 保持单一语义，现有 Skill 不被伪装成缺失能力。
