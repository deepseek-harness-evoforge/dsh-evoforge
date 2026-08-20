# V4.30 唯一 main 工作树与活动文档收口证据

> 日期：2026-08-21

## 结果

本地仓库从一个停在旧 P0A 分支的标准路径和 22 个 linked worktree，收口为标准路径下唯一 `main` 工作树与唯一本地分支。清理前逐个证明所有已提交分支都是 `main` 的 ancestor；干净工作树直接移除，两类未提交内容经内容审计后判定为已撤销架构残留，不并入 `main`。Git 已提交历史仍完整可审计，未 force-push、未重写远程历史。

## 删除的偏差内容

- 一份未跟踪调研稿把市场搜索、运行时能力获取和独立 `skill-discovery` 插件写成目标，与当前需求冲突，已删除；
- 两处未提交测试只针对已删除的 Feedback Shadow/Evaluator Draft 表面，已随旧 worktree 删除；
- 已撤销的 Feedback/Evaluator Draft、静态 Target、旧 Retention/canary、自动 review expiry 等领域词已从 `CONTEXT.md` 删除；
- 已撤销的 P1.1–P1.20 相关运行时架构/完成证据，以及外部 Skill 索引、archive、research Candidate 证据页已从活动文档删除；
- ADR 仍保留已撤销决策的原因，但不再链接或声称旧路径是当前产品合同。

## 重写的权威状态

- 顶层 README 现正确说明 exact Retention runner 和 Host Promotion Eligibility 已实现，canary/long-term Outcome 未实现；
- `evolution-design.zh.md` 已从“Candidate 是 Git commit”和历史 P1 编排收口为当前 `Opportunity → Evidence Seal → Candidate → Governance → Shadow → Retention → Promotion Eligibility` 链；
- 反事实 canary 被明确标记为 pending，且只能生成对未来 Session 有效的 `rollback-eligible` 证据，不直接拥有 release pointer。

## 验证

```text
git worktree list
→ 唯一 main worktree

git branch --format='%(refname:short)'
→ main

git rev-list --left-right --count HEAD...origin/main
→ 0 0（文档提交前基线）

pnpm run check:docs
→ Documentation links and public-path checks passed.
```

本增量不宣称 canary、真实 provider、真实飞书或 Hermes paired 已完成，也不触发 release tag。
