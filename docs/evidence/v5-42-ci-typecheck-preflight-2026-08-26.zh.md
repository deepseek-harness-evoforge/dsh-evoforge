# V5.42：干净 runner 的 Control Center 类型检查前置构建

日期：2026-08-26

## 发现

在 V5.41 的 DSH 双面构建修复后，GitHub Actions Node 22/24 runner 又暴露了第二个本地残留依赖：递归
`pnpm typecheck` 的消费者会按发布包的 `dsh-control-center/client` exports 读取 `lib`，而根脚本原先只在
`pretypecheck` 构建 `dsh-gateway`。本地已有未清理的 Control Center `lib` 时不会报错，干净 runner 则在类型
检查阶段直接失败。

## 修复

- 根 `pretypecheck` 先构建 `dsh-control-center`，再构建依赖它的 `dsh-gateway`。
- `scripts/check-ci-test-paths.mjs` 固定该前置顺序，防止本地生成物再次掩盖发布包入口缺失。

## 本地证据

```text
$ pnpm run typecheck
packages/dsh-control-center typecheck: Done
packages/dsh-gateway typecheck: Done
packages/dsh-evolve-web typecheck: Done
packages/dsh-feishu typecheck: Done
packages/dsh-telegram typecheck: Done

$ pnpm run check:ci
CI test path, DSH target, assembled build, and typecheck-preflight checks passed for 25 referenced files.
```

这是对真实 CI 失败的可重复性修复；新的 GitHub Actions 运行仍需完成后才能把 CI 记为通过，release gate 继续保持
原有阻断状态。
