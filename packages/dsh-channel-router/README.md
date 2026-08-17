# dsh-channel-router

`dsh-channel-router` 是一个默认关闭的 DeepSeek Harness 原生 Cordis Bundle。它把部署者声明的
external account/conversation/thread/user 五元组精确绑定到一个原生 DSH Workspace、Session 和 Agent
preset；它不是 bot、网关进程、Session 实现或 Agent Runtime。

## 安装

```sh
pnpm --filter dsh-channel-router pack --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-channel-router-0.1.0-alpha.1.tgz
```

Bundle row 默认为 `disabled: true`。部署者需在同一个 DSH profile 中覆盖配置后再启用：

```yaml
- id: evoforge-channel-router
  name: dsh-channel-router
  disabled: false
  config:
    routes:
      - id: telegram-personal
        adapter: telegram
        accountId: personal-bot
        conversationId: "100000001"
        userId: "200000002"
        workspaceId: 11111111-1111-4111-8111-111111111111
        sessionId: channel-personal-main
        agentPreset: standard
        provider: deepseek-official
        model: deepseek-v4-flash
```

`threadId` 只有平台事件确实有稳定 thread identity 时才配置。匹配是全字段精确匹配：没有通配、默认
Workspace、自动认领用户或模型可修改的 route。

## 原生边界

- Workspace 必须已经存在于 `WorkspaceRegistry`，目录状态必须为 `ok`；
- cold Session 只通过 `sessionPersistence` 检查并由 `agents.resume()` 恢复；新 Session 只通过
  `agents.create()` 创建，并由 Workspace 的 `attachSession()` 校验 cwd；
- live/cold Session 的 cwd 和实际 Agent preset 必须与静态 route 完全一致，否则启动或首个入口失败；
- 已注册 slash command 只通过 DSH `commands.execute()` 执行；普通文本用稳定 MessageId 进入原生
  Agent inbox；
- Storage Domain 只保留有界 ingress identity/status/Command 结果，不保存普通消息正文；同一事件内容漂移
  会拒绝，副作用边界崩溃会成为 `uncertain` 且不自动重放；
- 网络鉴权、平台 polling/webhook、Approval UI、outbound delivery/retry 属于 Telegram/飞书 Adapter。

当前 Router core 和双 Workspace 隔离合同已实现；Telegram 迁移及飞书 Adapter 仍是 v0.1 后续工作。

## 卸载

```sh
dsh plugin --profile web remove dsh-channel-router
```

卸载停止 Router 创建的 live Agent handle 并关闭它的 Storage Domain；原生 DSH Session、Goal、Workspace
及已经发生的外部效果不由本插件删除或回滚。
