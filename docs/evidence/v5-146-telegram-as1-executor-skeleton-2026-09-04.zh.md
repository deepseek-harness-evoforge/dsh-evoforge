# V5.146：Telegram AS-1 真实执行器骨架

日期：2026-09-04  
EvoForge revision：`5cb2ba8fdd87d62ae9dc2518e56065bfb74ebb87`；canonical DSH 最新审计仍为 `76fda729799fe9b3848dbe2c211d4b231032b81e`，
`0.1.2-rc.1`，`HEAD == origin/master`，clean。  
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 实现

- `benchmarks/telegram-v0.1/as1-real-channel/execute.ts` 复用已有 Feishu AS-2 验证过的 DSH `app-boot`、最终
  tarball、原生 Workspace/Session/Agent、Gateway request-id 审批和官方插件卸载路径；没有新增 Session、Agent
  Runtime、Gateway、状态库或网页。
- 授权后在仓库外隔离 run root 中打包并安装 `dsh-control-center`、`dsh-gateway`、`dsh-telegram`，等待真实 Bot
  私聊产生 pending request；首条不入 Agent，Host 批准后发送 exact challenge，等待原生回复，再做同一 Gateway
  ingress identity 的 Host 回放、原生 Approval、Host 重启、无需重新配对的第二次消息、官方卸载和 Session readback。
- `run.ts` 在未授权时只读取授权变量并退出 `not-run`；授权运行失败会保存私有 state/result，错误输出会脱敏 Bot token
  和 account，不能盲目重放同一个 run root。

## 验证

每次测试前重新 fetch/核对 canonical DSH 后执行：

```sh
pnpm benchmark:telegram:as1:typecheck
pnpm benchmark:telegram:as1:test
pnpm run check:docs
```

结果：类型检查通过，AS-1 合同 `8/8` 通过，文档检查通过。没有导出真实授权，不读取真实 Bot token，不连接 Telegram
API，也没有外部消息副作用。

## 边界

这是可审计的真实执行路径，不是已经完成的真实渠道证据。`real-telegram-as1` 仍为 `not-run`；只有用户明确授权并
在真实 Bot 私聊中完成全部人工阶段后，才可写入 `passed`。当前不能据此宣称 Telegram 真实可用、Hermes 上位替代或
允许创建 release tag。
