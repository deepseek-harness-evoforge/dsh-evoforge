# ADR-0063：治理面分离确定性 Admission 与 assembled Holdout

治理面生成的两份 Case Pack 不得使用同一执行等级。Admission 必须是 `dshAssembled: false` 的确定性、只读文件评测：不启动 DSH、不执行 Candidate、不调用模型或网络，只判断 exact capability-absent baseline 与 instruction-only Candidate 是否满足可机械检查的最低门。Holdout 必须是 `dshAssembled: true` 的独立真实 DSH 评测，验证 Skill 经 Loader、Agent 与模型历史进入真实任务路径。两者继续来自不同的生成前 protected Goal 子集，并分别校准。

V4.18 初始实现把两份 manifest 都标成 assembled，而 `SkillCandidateAdmission` 按设计拒绝 assembled evaluator；因此自动治理即使成功形成 Envelope，也会固定返回 `assembled-evaluator-not-governance-separated`，永远不能进入 holdout。修复不能放宽 Admission 去执行 Candidate，而应在治理包形成处按角色写入正确协议，并向治理作者明确不同 evaluator 合同。

治理模块同时提供有界只读 `scan`：仅投影 Workspace/Skill/Opportunity/seal、phase、0–2 次调用、token、预算延期和脱敏失败分类；不投影 protected Goal 正文、Case Pack/evaluator、provider identity、路径或原始错误。预算拒绝必须持久化为 `budget-deferred`，付费结果不确定继续拒绝盲重试。该投影只解释治理形成状态，不证明真实 provider 的 evaluator 质量，也不授予晋升或发布权。
