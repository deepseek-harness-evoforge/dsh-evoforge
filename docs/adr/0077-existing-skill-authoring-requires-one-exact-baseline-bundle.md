# ADR-0077：现有 Skill 编写资格必须绑定同一个精确完整基线 Bundle

`Existing Skill Improvement Opportunity` 只证明同一模型可见 invocation content 在多个独立 Goal 中收到明确纠正；它不证明这些调用来自同一个完整 Skill 包。references、脚本或二进制资源可以在渲染正文不变时发生变化，因此不能用 Skill 名、invocation-content hash 或当前目录替代历史 Bundle。

Host 新增独立的 `ExistingSkillBaselineQualification`。每次资格检查都重新发现当前 Opportunity 并核对完整快照，再从 durable FeedbackSignal 逐一取得 exact `(Workspace, Session, invocation seq)`，通过 `InstalledSkillBaselineVault.resolveInvocation()` 重验不可变引用、manifest、archive digest、tree、文件数和字节数。所有调用必须解析到同一个 baseline id，并与 route、Skill、Workspace 和 invocation-content hash 完全一致；任何证据漂移、归因错配、archive 损坏或多个 Bundle 冲突均返回 `invalid`，缺少任一调用基线返回 `waiting`。单次检查最多处理 100 个调用，超限时 fail closed，避免控制面查询变成无界 I/O。

通过后生成内容寻址的 `existing-skill-baseline-qualification-v1` manifest，身份绑定 Opportunity 快照、完整 baseline 摘要和确切 Signal/Goal 集合。其唯一含义是 `eligible-for-existing-skill-authoring`；固定 `releaseAuthority: none`，不生成 Candidate、不调用模型、不安装 Skill、不改变当前 Session 或 active Generation。后续 existing-Skill author、隔离 baseline/candidate Envelope、Shadow、Retention、Canary 和 Promotion 必须显式消费并重验该资格，不能借用缺失能力的新 Skill 链路。

DSH Host 控制面只向 Remote/Web 投影 qualification id、provider/source、内容摘要、tree、文件/字节数和证据计数；完整文件、Session id、主机路径和纠正正文不出 Host。Web 分别显示 qualified、waiting、invalid 和治理 unavailable，使 Bundle 冲突或损坏可见，但不提供绕过门禁的动作。

拒绝的替代方案包括：按 Skill 名选择当前版本、只比较渲染 hash、只取第一条纠正的 Bundle、在控制面即时扫描当前目录、把 qualification 直接当 Candidate，或允许 proposer 自行声明 baseline。它们都会引入版本错配、历史重建、裁判污染或当前 Session 漂移。
