# V5.78：飞书 WebSocket 重连健康投影（2026-09-03）

## 为什么修

常驻 Gateway 的连接不能把一次成功握手当作永久健康。此前 `dsh-feishu` 只监听官方 SDK 的 error；SDK
进入自动重连时，健康投影可能继续保持 `ready`，管理员无法在同一 DSH Web 控制面区分“已连上”和“正在
恢复”。这会把真实渠道故障隐藏在连接状态之后。

## 实现边界

- `FeishuPlatform` 增加可选 `onReconnecting` / `onReconnected` 生命周期 hook；官方 SDK 的
  `channel.on('reconnecting'|'reconnected')` 原样接入，旧替身平台无需实现；
- `FeishuRuntime` 在 reconnecting 时只更新现有 Gateway transport observation 为 `degraded`，在 reconnected
  时恢复为 `ready`；没有重启 DSH、重新配对、清空路由、发送探测消息或调用模型；
- `lastInboundAt` 不随重连更新，仍只在真实 Feishu message/cardAction 回调发生时写入，避免把连接活动冒充
  为平台事件；
- 所有展示继续复用 `dsh-control-center` 原生 `conversation.view`，没有新增网页、Router 或状态库。

## DSH 基线

编码和测试前重新执行 `git -C <deepseek-harness> fetch origin --tags`，确认远端最新
`master` 为 `76fda729799fe9b3848dbe2c211d4b231032b81e` 且 clean。该 master 的上游根级 tsdown 入口仍缺少
`lib/types/{index,invariant,startup}.js`，所以可执行插件测试使用已完整构建的
`dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；没有修改 DSH。

## 验证

```sh
DSH_SOURCE_ROOT=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm --filter dsh-feishu typecheck
DSH_SOURCE_ROOT=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm --filter dsh-feishu exec vitest run \
  test/runtime-dispose.test.ts test/platform.test.ts --maxWorkers 1
```

结果：typecheck 通过；2 个测试文件、5 个测试全部通过。运行时替身实际记录 `ready → degraded → ready`，
随后 Gateway stopping report 故意失败时，runtime 仍完成 outbound dispose、transport dispose 和官方平台
disconnect，验证了重连状态接入没有破坏故障清理。

## 门禁影响

这是常驻连接可观测性和恢复状态修复，不是外部平台事件证明。真实 Feishu AS-2 仍停在
`awaiting-resident-pairing-request`（没有收到匹配的陌生私聊事件），两套真实 Provider、Hermes paired、长期
负迁移/遗忘与完整真实浏览器门保持原状态；因此不创建 release tag。
