# ADR-0061：在 Candidate 生成前密封独立 Goal 证据

两个不同 Goal 仍足以形成 `Skill Opportunity`，但不足以同时提供作者证据、独立 admission 和未见 holdout。内部 whole-Skill authoring 因此必须先由 Evaluation Governance Plane 对 exact Opportunity 快照形成内容寻址的 `Skill Evaluation Evidence Seal`：至少四个不同 Goal，作者只得到有界 authoring 子集，admission/holdout 内容不进入 proposer 请求；密封 id 与 author-input digest 绑定 Candidate，并由 Evaluation Envelope v3 重新核对。样本不足、快照漂移或密封内容篡改均在预算和模型调用前 abstain/fail closed。该决定牺牲两-Goal 即刻生成的速度，换取 proposer 与验证样本的真实隔离；它尚不等于 admission/holdout Case Pack 已自主生成。
