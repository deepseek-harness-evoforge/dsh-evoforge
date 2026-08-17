# ADR-0042：GitHub 审查作为不可信数据回到原 Session

- 状态：accepted
- 日期：2026-08-17

`dsh-github-review` 在 allowlist reviewer 对 `complete_delivery` 记录的 exact Draft PR head 提交
`CHANGES_REQUESTED` 时，向原 Session 追加一条有界、内容寻址的 follow-up。选择直接复用原生
`Agent.followup`，而不是创建第二个任务、Mission、工作流或 Evolve Signal，因为用户结果是继续同一个
原生 Goal 完成交付返修。

Reviewer allowlist 只限制谁能触发 attention，不把 review 正文变成可信指令，也不授予 merge、release、
生产部署、秘密、付费或不可逆动作权限。URL 由已校验标识重建；正文和评论有硬上限；GitHub 读取不确定
时 fail closed。

插件只保留每个 Agent + repository 的当前 delivery watch，并用 `prepared → Agent.followup → delivered`
的顺序和确定 message id 跨崩溃去重。该选择牺牲组织级 PR 管理和多平台抽象，换取一个可删除、可解释、
不改 Tool/Skill/System 表面的交付闭环。
