# V5.194：Feishu Adapter 启动失败自动清理

> 日期：2026-09-04  
> 工作树：`main`（提交前证据）  
> 目的：验证 Feishu 常驻 Adapter 在连接前任一初始化阶段失败时，都会撤销已注册资源。

## 变更

`FeishuRuntime.start()` 以前只对 `platform.connect()` 失败执行 dispose；在 `resolve/bind/registerTextAdapter`
阶段失败时，已注册的 Gateway transport 可能残留，调用方也可能看到半启动状态。本轮把完整初始化过程放进同一
失败边界：

- 任何初始化异常都调用幂等 `dispose()`；
- 先回收已注册 outbound、平台监听和 transport，再原样抛出启动错误；
- 清理自身失败只记入 Host logger，不覆盖原始启动原因；
- 新增回归：Gateway transport 已注册但 outbound 注册失败时，transport 恰好销毁一次，平台连接从未发生。

这保持 Feishu 为 DSH Gateway 的薄 Adapter，不增加第二套连接管理或消息运行时。

## 最新 DSH 基线与验证

本轮测试前重新 fetch canonical DSH；`HEAD` 与 `origin/master` 均为
`d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`，clean）。官方安装通过；官方根构建仍因
`@deepseek-ai/dsh-root` 声明不存在的 `lib/types/{index,invariant,startup}.js` 入口而分类为
`blocked-upstream-root-types-entry`。未修改 DSH 源码。

- Feishu 定向 typecheck/build 与 runtime teardown：`2/2`；全包：`19 files / 56 tests passed`。
- Telegram：`10 files / 36 tests passed`；Gateway：`8 files / 43 tests passed`；Evolution：`69 files / 309 tests passed`。
- 使用已审计 alpha.5 支持 checkout 的根级 `pnpm run check`：`CHECK_RC=0`。
- 文档、CI、Bundle、类型、构建、clean-profile 和发布合同检查通过；真实渠道、Provider、Hermes paired、长期效果、npm ownership 与 tag 仍阻断。

## 结论边界

这是 Adapter 生命周期可靠性证据，不代表真实 Feishu AS-2 已通过，也不代表 Hermes 上位替代已完成。完整 paired benchmark 和真实外部效果仍须按授权合同执行。

