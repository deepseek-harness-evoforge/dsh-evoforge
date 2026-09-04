# V5.169：最新 DSH 自动审计命令

日期：2026-09-04  
EvoForge revision：`f109db3061950e299619ac270695a2fd8b9ef183`  
canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，clean）

## 实现

新增 `pnpm run audit:dsh:latest`，在不修改 DSH 源码的前提下自动 fetch `origin/master`，核对
`HEAD == origin/master`、版本和 clean worktree，执行官方 frozen install 与根级 build，并把结果分类为：

- `0`：最新 DSH 安装与根构建通过；
- `2`：仅识别到已审计的 `@deepseek-ai/dsh-root` `lib/types/{index,invariant,startup}.js` 上游入口缺陷；
- `1`：脏 checkout、依赖安装失败或任何未知构建失败（fail closed）。

脚本通过 `classifyBuildFailure()` 单测 `2/2`，并已接入根 `pnpm check`，不会把新的错误误归为已知上游问题。

## canonical DSH 实测

```text
node scripts/audit-dsh-latest.mjs --source /path/to/deepseek-harness --offline --json
revision == origin/master: true
version: 0.1.2-rc.1
install: 0
build: 1 / blocked-upstream-root-types-entry
blocked: known-upstream-build-defect
AUDIT_RC=2
```

该结果与 [V5.162](v5-162-dsh-rc1-root-build-boundary-2026-09-04.zh.md) 一致；alpha.5 仍是完整可构建支持基线。
