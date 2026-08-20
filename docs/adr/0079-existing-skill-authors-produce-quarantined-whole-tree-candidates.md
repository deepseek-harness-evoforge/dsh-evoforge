# ADR-0079：现有 Skill 作者只能产生隔离的完整目录树 Candidate

- 状态：Accepted
- 日期：2026-08-21

## 背景

V4.33–V4.35 已依次封存调用时完整 Skill Bundle、把全部精确纠正绑定到同一基线，并在编写前隔离 authoring/admission/holdout/Retention 证据。仍缺少真正的改进制品：若只保存 `SKILL.md` patch，会丢失 reference、asset 和二进制资源；若让 proposer 接触完整治理样本、外部市场或安装路径，又会泄漏评测面并重新引入用户选路和能力获取。

## 决策

新增独立的 `ExistingSkillCandidateAuthoring` 与 existing-Skill Candidate contract：

1. Module 只从 DSH 内部 `SkillImprovementOpportunity` 自主取任务，不接受用户选择的 Skill、路径、来源或工作流，也不搜索或获取外部能力；
2. proposer 只能读取精确 sealed baseline 的有界文本文件、二进制文件的 digest/size 元数据和 authoring cases；admission、holdout、Retention、Session/message identity 不进入请求；
3. proposer 只能返回对 root `SKILL.md` 和一层 `references/*.md` 的 1–32 个文本替换/新增；Host 拒绝删除、rename、path drift、identity drift、代码/二进制修改、no-op、超限和 permission/license declaration 漂移；
4. Host 从 exact baseline 重新组装完整 canonical archive，逐字继承所有未修改文件，包括二进制资源；Candidate 以完整 archive/tree、baseline、qualification、evidence 和 author identity 内容寻址；
5. existing-Skill Candidate 使用独立 DSH Storage domain 和 Host-owned 0600 artifact vault，不伪装成 capability-absent 新 Skill Candidate；
6. paid call 前持久化 intent，未观察到结果或重启发现 pending 时标记 `uncertain` 并拒绝盲重试；原生 DSH Jobs 是唯一运行观察面；
7. Candidate 固定 `inactive`、`quarantined`、`unevaluated`、`never executed`、`releaseAuthority: none`。Module 没有安装、激活、评测、晋升或发布接口；
8. DSH Web 的权威控制面只显示 authoring phase/cost、baseline/qualification/evidence identity、Candidate tree 和 changed/added/preserved 摘要，不显示 claim、正文、Host 路径或保护样本。

## 后果

- 现有 Skill 的改进第一次成为可重放、可审计的完整目录树 Candidate，而不是孤立文本 patch；
- proposer 与最终裁判保持隔离，二进制/代码/权限/license 不会借“指令改写”被暗改；
- 崩溃不会触发可能重复付费或产生重复制品的盲重试；
- 本决策仍不证明 baseline/candidate paired evaluation、Retention、Canary、回滚、自动晋升或 Hermes 上位替代；这些必须由后继治理链独立实现和验证。
