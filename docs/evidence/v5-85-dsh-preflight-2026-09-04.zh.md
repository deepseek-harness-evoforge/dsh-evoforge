# V5.85：完整检查 DSH preflight（2026-09-04）

## 问题

EvoForge 的 assembled 测试必须使用精确的 DSH revision。过去直接运行 `pnpm run check` 在缺少环境变量
时，部分测试会回退到相邻 checkout，直到深层测试才暴露 revision mismatch；这会让开源贡献者误以为是
EvoForge 回归，也浪费一次完整检查窗口。

## 改动

根级 `check` 现在首先运行 `check:dsh:preflight`。它要求显式的
`DSH_EVOLVE_DSH_SOURCE_DIR`，并调用同一份 exact compatibility allowlist 校验 DSH 版本、revision 和
tracked worktree。缺少变量、版本错配、未知 revision 或 dirty checkout 都会在测试/构建前立即给出修复命令；
不会自动选择附近 checkout，也不会放宽支持范围。文档和用户 README 同步给出可复制的环境变量示例。

## 验证

- 无环境变量：preflight 立即退出，并提示 `DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm run check`；
- 静态套件（含 preflight 缺失变量合同）：5/5 通过；
- 使用已构建、干净的 DSH `0.1.2-alpha.5` 支持基线执行完整 `pnpm run check`：preflight、文档、CI、套件、
  合同、12 包 typecheck、测试和 build 全部通过；关键测试计数与 DSH revision 见
  [V5.84 证据](v5-84-alpha5-full-check-2026-09-04.zh.md)。

最新 DSH `master` `76fda729…` 仍单独审计，不能因为 preflight 通过就变成已支持目标；真实 Feishu、双 Provider、
Hermes paired、长期效果和 release tag 门禁也没有变化。

