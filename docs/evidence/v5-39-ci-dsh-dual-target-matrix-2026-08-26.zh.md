# V5.39：开源 CI 覆盖两组已审计 DSH 目标

日期：2026-08-26

## 问题

开源 CI 的 macOS assembled job 只 checkout `0.1.0-rc.5`，而项目已经声明同时支持 `0.1.0-rc.5` 与当前
`0.1.1-rc.2`。仅测试旧目标会让最新 DSH 兼容性回归依赖本地脚本，不能作为公开仓库的持续证据。

## 修复

`.github/workflows/ci.yml` 的 assembled job 现在使用不共享工作树的矩阵，分别 checkout 并运行同一套
clean-profile、native Bundle、assembled Session/Goal、卸载和恢复测试：

| DSH | revision |
|---|---|
| `0.1.0-rc.5` | `47f943859bef60e4160492346772ded9b24f765a` |
| `0.1.1-rc.2` | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |

这两个目标与 `scripts/run-dsh-compatibility-matrix.mjs` 的 allowlist 完全一致；任意未审计 revision 仍会被
兼容性脚本拒绝。`check:ci` 同时保证矩阵中引用的测试文件存在。

## 证据

```text
YAML parse: jobs=[check, assembled-darwin]
assembled-darwin matrix: 0.1.0-rc.5 + 0.1.1-rc.2
CI test path check passed for 25 referenced files.
pnpm run check  # passed: docs, CI paths, suites, gates, typecheck, tests, build
```

本增量只修复公开 CI 的目标覆盖与可重复性，不宣称真实 Provider、真实渠道、Hermes paired 或长期效果已通过。
