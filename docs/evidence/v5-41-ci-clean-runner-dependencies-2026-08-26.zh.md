# V5.41：开源 CI 干净 runner 依赖与 DSH 双面构建

日期：2026-08-26

## 发现

GitHub Actions 的真实 Node 22/24 runner 暴露了一个本地工作区会掩盖的问题：`dsh-feishu` 的 benchmark 合同
直接执行 `tsx`，但包自身没有声明该开发依赖；本地因为 workspace hoisting 能运行，干净 runner 则在
`pnpm --filter dsh-feishu exec tsx` 阶段失败。

同一轮 macOS assembled CI 还显示，最新 DSH rc.2 只执行 `build:lib:host` 时，clean profile 的依赖回退会解析
client-declared `@deepseek-ai/dsh-typert-registry` 的 package main，却找不到其 `lib/index.js`。这是 DSH 的
Host/Client 构建面被错误缩窄，不是 EvoForge 运行时可以吞掉的可选依赖。

## 修复

- `packages/dsh-feishu/package.json` 直接声明 `tsx`，并用锁文件记录精确解析版本。
- macOS assembled job 改为执行官方 DSH `build:lib`，同时生成 Host 与 Client 入口；这保证 clean-profile
  Loader 解析 client-declared package 时不会依赖开发机残留产物。
- `scripts/check-ci-test-paths.mjs` 现在强制检查该双面构建命令，防止 CI 回退到 Host-only。

## 本地证据

```text
$ pnpm run check:ci
CI test path, DSH target, and assembled build checks passed for 25 referenced files.

$ pnpm --filter dsh-feishu exec tsx --version
tsx v4.23.12
node v24.14.0

$ pnpm --dir .evoforge/deepseek-harness build:lib:client
Build complete (including @deepseek-ai/dsh-typert-registry/client)
```

该增量修复开源 CI 的可重复性，不宣称 GitHub Actions 已重新通过，也不改变任何 release gate；新的 CI 运行仍需
在推送后复核。
