# DSH 0.1.2-rc.1 迁移审计（2026-09-03）

本报告记录 DSH 最新公开 release 和 master 的可复现状态。它不把上游构建失败转化为 EvoForge
支持声明；当前 EvoForge 仍只对已经完成 assembled/clean-profile 矩阵的 alpha.5 做兼容承诺。

## 固定 revision

| 基线 | revision | 版本 | 结果 |
|---|---|---|---|
| 最新公开 tag | `a66e4702047846cdaa10c66c9d3df3951f5ea70d` (`dsh-v0.1.2-rc.1`) | `0.1.2-rc.1` | `pnpm install --frozen-lockfile` 通过；完整 `pnpm build` 在根级 tsdown 入口失败 |
| 最新远端 `master` | `76fda729799fe9b3848dbe2c211d4b231032b81e` | `0.1.2-rc.1` | `pnpm install --frozen-lockfile` 通过；与 rc.1 tag 的源码差异主要是版本发布同步 |

本轮先执行 `git fetch --tags --prune` 和 `git pull --ff-only origin master`，确认本地 DSH clean，
再安装依赖和运行官方构建。DSH 工作树没有被 EvoForge 修改。

## 构建事实

1. 首次完整构建遇到 14 个缺失导出，来源是旧的 ignored `packages/host/apiproxy/lib/types/api-proxy.js`；
   删除这个可再生生成目录后，`pnpm build:lib:client` 通过，证明该组错误是 stale artifact。
2. 再次执行完整 `pnpm build` 时，host 侧 workspace tsdown 报：
   `[@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`。
   根目录 solution 没有对应 `lib/types` 入口；这是上游干净 checkout 的构建配置问题，不是 EvoForge
   运行时代码能够修复或应当掩盖的错误。
3. 因而本轮没有把 rc.1 放入 EvoForge peer/support allowlist，也没有把部分生成的 DSH `lib` 当作正式
   release 产物。最新完整可构建公共基线仍是 `dsh-v0.1.2-alpha.5` /
   `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

## 对 EvoForge 的决定

- rc.1 与 alpha.5 的源码 API 差异尚未观察到，但版本和构建身份不同，不能仅凭“类型大致相同”扩大兼容声明。
- 继续开发时必须先更新并审计 rc.1；需要运行时证据时，使用已经完整构建的 alpha.5 干净 checkout，并在证据中
  明确记录原因。
- 只有上游 rc.1 clean build 通过，且 EvoForge 重新完成 typecheck、pack、add/dump/boot、reload/dispose、
  Session/Goal 恢复、真实浏览器、真实渠道和卸载矩阵，才允许把支持基线改为 rc.1。

