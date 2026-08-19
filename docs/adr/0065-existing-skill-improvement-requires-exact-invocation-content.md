# ADR-0065：现有 Skill 改进必须先按精确调用内容版本分组

现有 Skill 的纠正不能沿用缺失能力的 `capability-absent` Opportunity，也不能按 Skill 名聚类。Host 对 feedback 目标回答中唯一成功的 durable Skill 调用，计算模型当时实际看到的 content blocks 的 SHA-256；只有同一 Workspace、同一 Skill 名、同一 invocation-content hash 在至少两个不同原生 Goal 中收到明确负向纠正，才形成 `Existing Skill Improvement Opportunity`。重复 Signal、同 Goal retry、历史无 hash 记录和同名不同内容版本均 abstain。该 Opportunity 固定 `causalClaim: none`、`waiting-for-baseline-bundle` 且无发布权；invocation hash 只证明模型可见调用内容相同，不是完整 Skill Bundle、资源树或安装版本。完成“调用时安全封存完整内容寻址 Bundle，并证明其与调用内容一致”的后继合同前，Slow Loop、Envelope、Candidate、安装、晋升与发布都不得消费它。
