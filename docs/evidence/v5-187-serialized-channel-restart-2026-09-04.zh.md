# V5.187：渠道凭据轮换串行化与最新 DSH 全仓验证

> 日期：2026-09-04。范围：在已审计 DSH 当前远端之后，验证 Feishu/Telegram 凭据更新队列不会并发销毁与启动 Adapter。

## 变更

Feishu 与 Telegram 的常驻 Adapter 各自增加 `restartChain`。每次原生
`credentials/reference-updated` 事件都追加到同一条 Promise 队列：先等待上一代
`dispose` 完成，再启动最新凭据代际；更新期间的错误只记录并继续后续队列。Host
卸载会先等待该队列与正在进行的启动 Promise，避免卸载返回后仍有孤儿连接或新连接
在后台复活。候选连接仍受上一轮代际门禁保护，不会把过期凭据的启动结果发布为 live runtime。

## 验证结果

- 最新 DSH 重新 fetch 后 canonical `origin/master` 为
  `76fda729799fe9b3848dbe2c211d4b231032b81e`；运行支持 checkout 为
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）。
- Feishu：`vitest --maxWorkers 1` 为 `19 files / 55 tests`，typecheck/build 通过。
- Telegram：`vitest --maxWorkers 1` 为 `10 files / 36 tests`，typecheck/build 通过。
- 根级最新 DSH 完整 `pnpm run check` 权威退出码 `CHECK_RC=0`；Evolution `309/309`、Gateway `41/41`，其余 Bundle、Typert、类型检查、构建、clean-profile 与发布契约检查均通过或按外部条件明确跳过。

## 边界与未决门禁

该证据只证明本地生命周期并发与全仓回归没有回归，不证明真实 Feishu 入站/配对/回复、Telegram AS-1、真实 Provider、同条件 Hermes 长期 paired、npm 维护者归属或 SemVer 发布。当前 release gate 仍为 `blocked`；未创建 Git 分支或 tag，代码只在 `main` 上提交。
