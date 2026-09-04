# V5.191：Feishu runtime 监听收口与最新 DSH 全仓验证

> 日期：2026-09-04。范围：修复 Feishu 常驻 runtime 在热重载/卸载后的 Cordis 监听残留，并在重新 fetch 的最新 DSH 基线上完成全仓验证。

## 变更

Feishu runtime 现在保存并撤销全部 `agent/*`、`session/event`、`approval/request` 以及平台消息、审批、错误、拒绝和重连监听；
`start()` 在已销毁实例上 fail-closed，`dispose()` 幂等。原生凭据更新监听仍由 Host effect teardown 注销，旧代际不会在卸载后被重新启动。
这使 Feishu 与 Telegram 的 resident Adapter 生命周期遵守同一条“先失效、再完整 dispose、最后允许新代际启动”的边界。

## 验证

- 本轮验证前重新 fetch 并审计 DSH：canonical `origin/master` 为
  `76fda729799fe9b3848dbe2c211d4b231032b81e`；运行支持 checkout 为
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）。
- Feishu `19 files / 55 tests`、Telegram `10 files / 36 tests`、两包 typecheck/build 通过。
- 根级最新 DSH 完整 `pnpm run check` 权威退出码为 `CHECK_RC=0`；Evolution `309/309`、Gateway `41/41`，其余 Bundle、Typert、
  clean-profile、浏览器 fixture 和发布契约检查均通过或按外部条件明确跳过。
- `git diff --check` 与 `pnpm run check:docs` 通过；改动将以单个原子 commit 推送 `origin/main`。

## 边界

本证据只覆盖 Feishu/Telegram 本地 runtime 生命周期、构建和回归测试，不证明真实 Feishu AS-2、Telegram AS-1、Provider RP-1、
同模型 Hermes paired、长期负迁移或 npm 维护者归属。发布 gate 继续 `blocked`，没有创建功能分支或 SemVer tag。
