# V5.189：Telegram runtime 卸载收口与最新 DSH 全仓验证

> 日期：2026-09-04。范围：修复静态/配对 Telegram runtime 在热重载与卸载后的监听器残留，并验证凭据更新不会在 Host dispose 后重启。

## 变更

静态 `TelegramRuntime` 与 `TelegramPairingRuntime` 现在保存并撤销全部 Cordis `agent/*`、`session/event` 与 `approval/request` 监听，
并以幂等 `disposed` 门保护重复卸载。Pairing approval 的 abort listener 仅在实际存在时移除，避免将 `undefined` 作为回调传给
`removeEventListener`。插件 Host 层也会在自身 effect teardown 时注销原生 `credentials/reference-updated` 监听；已排队的代际重启仍
按 V5.187 的串行队列完成后才返回。

## 结果

- 最新 DSH 重新 fetch 后 canonical `origin/master` 为
  `76fda729799fe9b3848dbe2c211d4b231032b81e`；运行支持 checkout 为
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）。
- Telegram 定向生命周期回归通过；卸载后再次发出凭据更新不会增加 Transport/Adapter 注册或 dispose 次数。
- Telegram `10 files / 36 tests`、Feishu `19 files / 55 tests`、两包 typecheck/build 均通过。
- 根级最新 DSH 完整 `pnpm run check` 权威退出码 `CHECK_RC=0`；Evolution `309/309`、Gateway `41/41`，其余 Bundle、Typert、clean-profile 与发布契约检查均通过或按外部条件明确跳过。

## 边界与未决门禁

该证据只覆盖本地 Cordis 监听生命周期和卸载幂等性，不证明真实 Telegram/Feishu、Provider、Hermes paired、长期运行、npm 维护者归属或 SemVer 发布；release gate 继续 `blocked`，未创建分支或 tag。
