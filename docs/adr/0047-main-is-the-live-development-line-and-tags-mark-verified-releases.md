# ADR-0047：main 是实时开发线，tag 只标记验证发布

- 状态：accepted
- 日期：2026-08-18

## 背景

项目所有者要求开发进展实时同步到代码仓库，不以功能分支区分进度；核心功能实现并验证通过后才用 tag
标记迭代。仓库同时包含 `dsh-software-delivery` 和运行时 Evolution Candidate，若不区分三者，容易把
产品自身 Git 流程、用户仓库 Draft PR 流程和能力候选版本错误混为一谈。

## 决定

`dsh-evoforge` 自身只有 `main` 这一条实时开发与集成线。维护 Agent 直接在 `main` 产生小步、可测试、
可回退的 commit，并在每批验证后 push 到 `origin/main`；不创建新的 feature/release branch，不
force-push，不重写已推送历史。遇到历史工作树时先只读审计并把已验证内容合入 `main`。

运行时 Candidate、Skill package 与 Generation 使用隔离、内容寻址、Workspace-scoped 存储，不用 Git
branch 表示。只有预先冻结的核心能力集合通过 docs/typecheck/test/build、clean-profile assembled、
故障注入、真实浏览器/渠道、缓存与 paired benchmark 门禁后，才在 `main` 创建 annotated semantic
tag；tag 说明必须列出支持范围、固定 revision、证据和仍未验证的边界。

## 结果

- 远端 `main` 持续反映最新已验证进展，失败的中间态不会被伪装成发布；
- 小步提交和普通 revert 提供代码恢复路径，tag 提供已验证产品迭代的稳定定位；
- runtime Candidate 不污染源码历史，也不能通过合并 branch 绕过 Evaluation Governance Plane；
- `dsh-software-delivery` 仍可按用户仓库授权创建 worktree、commit、push 和 Draft PR，该产品能力不改变
  EvoForge 自身的 main-only 规则。

## 拒绝方案

- 每个能力建立 feature branch：与所有者要求冲突，并让远端 main 无法实时反映进展；
- 每次 commit 都打 tag：把进度标记误当经过验收的发布；
- 用 Git branch 保存运行时 Skill Candidate：泄漏 Workspace 边界并耦合源码发布与能力晋升；
- 为保持线性而 force-push：破坏已同步证据和可追溯性。
