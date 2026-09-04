# DSH 最新版本审计（2026-09-05）

这是本轮开发前执行的官方仓库审计，保存可复核事实，不把上游构建失败转嫁给 EvoForge，也不扩大支持声明。

## 固定事实

| 项目 | 值 | 结论 |
| --- | --- | --- |
| 来源 | 官方 `deepseek-harness` checkout（路径由调用者传入） | 本地官方 checkout |
| revision | `d347e703908d0406b7a7ef80e3a0e594d86b2215` | 与 `origin/master` 一致 |
| 版本 | `0.1.3-alpha.1` | 最新审计身份 |
| 工作树 | clean | 未被 EvoForge 修改 |
| install | exit 0 | 依赖安装通过 |
| build | exit 1 | 上游 `dsh-root` 缺少 `lib/types/{index,invariant,startup}.js` 入口 |

## 支持决策

最新审计版本不是当前可宣称的运行时支持版本。EvoForge 的 assembled/clean-profile 支持矩阵仍锁定已构建的 `dsh-v0.1.2-alpha.5`；任何升级到 `0.1.3-alpha.1` 都必须先解决上游 clean build，再重跑 typecheck、pack、DSH add/dump/boot、reload/dispose、Session 恢复、真实 Web/渠道和卸载门禁。

## 对维护工作的约束

1. 每次代码或测试增量开始前重新运行 `pnpm run audit:dsh:latest -- --source <checkout> --json`，保存 revision、版本、install/build 状态。
2. `latest audited`、`buildable support`、`tested release` 是三个不同事实；README 只能声明后两者已经有证据的部分。
3. 不修改上游 checkout，不用残留 `lib` 产物掩盖 clean build 失败，不把该失败标记为 EvoForge 功能通过。

完整原始输出由审计脚本生成；本页只保留人可读摘要，详细 evidence 仍以日期化文件和 Git 提交为准。
