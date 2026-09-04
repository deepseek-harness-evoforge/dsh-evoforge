# V5.188：异步凭据轮换重叠门禁与最新 DSH 全仓验证

> 日期：2026-09-04。范围：用受控的异步 Adapter 释放阻塞验证凭据轮换不会启动重叠连接。

## 验证设计

Telegram 生命周期回归现在会在旧候选 Adapter 的 `dispose` 中人为保持挂起，然后连续提交两次原生凭据更新。测试要求第二代在旧代
尚未释放时不能注册新的 Transport；释放闸门后才允许最新代际启动，并断言整个过程中活动 Adapter 最大并发数为一。该测试仍使用
官方 DSH/Cordis 生命周期与本地隔离 HTTP fixture，不伪装成真实 Telegram 平台通过。

## 结果

- 最新 DSH 重新 fetch 后 canonical `origin/master` 为
  `76fda729799fe9b3848dbe2c211d4b231032b81e`；运行支持 checkout 为
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）。
- 专项 Telegram 异步释放竞态测试：`1 file / 1 test` 通过。
- 根级最新 DSH 完整 `pnpm run check` 权威退出码 `CHECK_RC=0`；Evolution `309/309`、Gateway `41/41`、Feishu `19 files / 55 tests`、Telegram `10 files / 36 tests`，其余 Bundle、Typert、类型检查、构建、clean-profile 与发布契约检查均通过或按外部条件明确跳过。

## 边界与未决门禁

这只证明本地渠道生命周期在最坏异步释放时保持串行，不证明真实 Telegram/Feishu 入站、配对、回复、Provider、Hermes 长期 paired、npm 维护者归属或 SemVer 发布。release gate 仍为 `blocked`；没有创建分支或 tag。
