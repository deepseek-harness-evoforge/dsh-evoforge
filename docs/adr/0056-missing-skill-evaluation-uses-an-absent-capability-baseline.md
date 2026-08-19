# ADR-0056：缺失 Skill 的评测必须使用 capability-absent baseline

`SkillOpportunity` 只会在 DSH 的完整原生 catalog 已确认 exact Skill 不存在、且至少两个独立 Goal 形成重复
Gap 后产生。因此这类 Opportunity 的 baseline 不是“旧版 Skill”，更不能由治理者放入一个 no-op 或占位
`SKILL.md`。占位包会改变 DSH Loader、Skill catalog、调用路径和模型可见历史，把“DSH 没有该能力”偷换成
“DSH 已经有一个表现差的能力”，所得 improvement 不再对应真实用户起点。

Evaluation Envelope 升级为 `internal-skill-evaluation-envelope-v2`。其 baseline 固定为
`capability-absent`，目录只能包含一个严格 `subject.json`，绑定 Workspace、Opportunity 和缺失 Skill 名；
任何 `SKILL.md`、额外文件、symlink、身份不一致或内容漂移都 fail closed。Trial 使用显式 subject protocol
把 `skill-tree | capability-absent` 与 Skill 名传给 evaluator；只有声明
`capabilityAbsentBaseline: true` 的 evaluator 才能消费缺失 baseline，且缺失侧不得包含 Skill 包。

assembled evaluator 在 baseline DSH profile 中不安装目标 Skill，在 Candidate profile 中才安装 exact whole-Skill
Candidate。两侧固定同一 DSH revision、驱动、预算与 evaluator；composition fingerprint 必须排除唯一允许的目标
Skill presence/body 差异，其他组合仍须一致。Admission、Shadow、durable run identity、crash resume 与 Review
projection 都携带该 baseline kind。Candidate 仍无 release authority，当前 Session 不受影响。

这是对 ADR-0055 中“baseline tree”的语义收紧，不提供 v1 Envelope 兼容读取。旧布局应被治理面重新生成，不能
自动翻译成缺失能力。本 ADR 落地时只完成真实 absent baseline 的消费与 assembled DSH 证明；当时的
Git-backed Publisher、Retention 和 canary 仍假设既有 Skill。后继 ADR-0057 已建立 whole-Skill Candidate
的内容寻址 publication/future-Session 路径，ADR-0058 又让 Retention/canary 使用 exact absent subject 与
whole-Skill Candidate，而没有重新引入 Git baseline。
