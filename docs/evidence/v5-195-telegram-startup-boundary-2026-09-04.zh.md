# V5.195：Telegram Adapter 启动边界与幂等 teardown

> 日期：2026-09-04  
> 工作树：`main`（提交前证据）  
> 目的：验证 Telegram 静态与 pairing Adapter 的公开 runtime 在重复启动、部分初始化失败和健康上报异常时仍可安全回收。

## 变更

- `TelegramRuntime` 与 `TelegramPairingRuntime` 增加单次启动闸门，重复 `start()` 直接返回，不会重复注册 transport、outbound 或 Cordis 监听；
- 两个 runtime 的完整初始化均位于失败清理边界，注册 transport 后的任意异常会 dispose 已有资源并保留原始错误；
- teardown 的 transport 健康上报、监听撤销和 transport dispose 各自隔离，某一步失败不会阻断后续回收；
- 新增回归覆盖静态启动失败清理和 pairing 重复启动，确保资源注册/销毁计数精确。

实现仍复用 DSH 原生 Session、Goal、Approval 和 Gateway；没有新增 Telegram 专属运行时或第二套状态。

## 最新 DSH 与验证

本轮测试前重新 fetch canonical DSH：`origin/master` 为
`d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`，clean，HEAD 与远端一致）。官方安装通过；官方根构建仍因
`@deepseek-ai/dsh-root` 缺失 `lib/types/{index,invariant,startup}.js` 入口而分类为
`blocked-upstream-root-types-entry`，未修改 DSH 源码。

- Telegram：`11 files / 38 tests passed`，typecheck/build 通过。
- Feishu：`19 files / 56 tests passed`；Gateway：`8 files / 43 tests passed`；Evolution：`69 files / 309 tests passed`。
- 使用已审计 alpha.5 支持 checkout 的根级 `pnpm run check`：`CHECK_RC=0`。
- 文档、CI、Bundle、类型、构建、clean-profile 与发布合同检查通过；真实 Telegram/Feishu、Provider、Hermes paired、长期效果、npm ownership 和 tag 门禁仍阻断。

## 结论边界

这是渠道 runtime 生命周期可靠性证据，不代表真实外部渠道已通过，也不代表 Hermes 上位替代已完成。真实 paired benchmark 和外部效果必须按授权合同执行。

