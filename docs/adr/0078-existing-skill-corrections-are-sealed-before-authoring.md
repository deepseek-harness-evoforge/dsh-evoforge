# ADR-0078：现有 Skill 的纠正内容必须在编写前受保护封存

- 状态：Accepted
- 日期：2026-08-21

## 背景

`FeedbackSignal` 有意只保存当前负向反馈的引用、版本和精确 Skill 调用归因，不复制用户的纠正文、Prompt 或 Transcript。V4.34 已能证明多个纠正引用使用同一个完整已安装 Skill Bundle，但这仍不足以生成改进：如果 proposer 只看到旧 Bundle 而看不到用户具体纠正，所谓“自我改进”只能靠猜；如果直接把全部纠正交给 proposer，又会泄漏 admission/holdout，使后续评测失去独立性。

## 决策

新增 Host-owned `ExistingSkillEvaluationEvidenceVault`：

1. 只接受当前 `SkillImprovementOpportunity`，并先重跑 `ExistingSkillBaselineQualification`；
2. 通过 DSH 官方 `MessageFeedbackService.list()` 读取当前 feedback，通过官方 `SessionPersistence.inspect()` 重放精确目标回答之前的 durable Session；不读取 message-feedback 或 Session 的私有存储表；
3. 重验 feedback message/version/updatedAt、assistant seq/turn、唯一用户请求、唯一成功 Skill invocation、route/seq/content hash 和 exact Goal id/revision；任一漂移、歧义或不可读都 abstain；
4. 至少四个不同 Goal 才形成证据：确定性内容寻址排序后，两个或以上供 authoring，一个供 admission，一个供 holdout；第五个及以上时固定保留一个 retention；同一 Goal 的重复纠正只选一个；
5. 在 Candidate 调用前把 Goal objective、有界用户文本、纠正文和完整来源引用写入治理根的 0600 内容寻址 manifest；非文本请求块只记录“已省略”事实，后续 paired evaluation 不得冒充完整重放；
6. `prepare()` 返回给 proposer 的深接口只包含 authoring cases、baseline/qualification/evidence identity 和分区计数；`readForGovernance()` 才能读取 admission/holdout/retention；
7. evidence 固定 `releaseAuthority: none`，不创建 Candidate、不安装 Skill、不切换 Generation，也不影响当前 Session。

DSH Web/Remote 只显示 readiness、内容地址、分区计数和有界阻断原因，不下发纠正文、请求正文、Session/message identity 或保护样本。

## 后果

- 现有 Skill 的 proposer 终于能基于真实内部纠正编写，而不是根据 Skill 名或旧正文猜测；
- proposer 与独立评测样本在生成前即隔离，不能由 Candidate 选择或改写；
- 少于四个不同 Goal 时，系统甚至不读取纠正文，也不花模型预算；
- 当前 feedback 更新/删除、Session 漂移、证据超限和治理文件篡改全部 fail closed；
- 本决策只完成 authoring 前置证据，不证明 whole-tree Candidate、baseline/candidate paired evaluation、晋升或 Hermes 上位替代。
