# dsh-gateway

`dsh-gateway` 是默认关闭的 DeepSeek Harness 原生 Cordis Bundle，也是 Telegram、飞书等渠道
Adapter 共用的 Host 接缝。它把部署者声明的 external account/conversation/thread/user 精确绑定到一个
原生 DSH Workspace、Session 和 Agent preset，并负责进入 DSH 前的标准化、路由、幂等和崩溃不确定性。
它不实现网络 Bot，不拥有 Goal、Session、Agent Runtime、Schedule 或 Approval，也不是独立网关进程。

## 安装

```sh
pnpm --filter dsh-gateway pack --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-gateway-0.1.0-alpha.1.tgz
```

Bundle row 默认为 `disabled: true`。部署者在同一个 DSH profile 中配置精确 route 后启用：

```yaml
- id: evoforge-gateway
  name: dsh-gateway
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

匹配是全字段精确匹配：没有通配、默认 Workspace、自动认领用户或模型可修改的 route。`threadId` 只有
平台事件具备稳定 thread identity 时才配置。

## 当前已实现的 Gateway 接缝

- 启动时完整验证 route、Workspace、Session、Agent preset 和模型归属，错误配置 fail closed；
- 新建或恢复原生 DSH Agent，并由 Workspace `attachSession()` 校验 cwd；
- 已注册 slash command 只走 DSH `commands.execute()`，普通文本以稳定 MessageId 进入原生 Agent inbox；
- 以 DSH Storage Domain 保存有界 ingress identity/status/Command 结果，不保存消息正文；
- 同一外部事件只执行一次；内容或归属漂移被拒绝；effect 边界崩溃标记为 `uncertain`，不盲目重放；
- `healthSnapshot()` 从 Gateway 自有 route、原生 Agent 注册表和 ingress journal 生成脱敏权威快照，支持
  exact route 子集、生命周期、live Session 与 prepared/executing/settled/uncertain 计数；
- Cordis dispose 等待在途入站、释放 Gateway 创建的 Agent handle，并关闭自己的日志。

Telegram 和飞书已经通过这个接缝运行。网络鉴权、SDK/WebSocket/polling、平台事件解析、Approval UI 与
平台发送目前仍在各 Adapter；公共 outbound delivery、跨 Adapter 限流、平台 transport 健康聚合和统一 Web
展示尚未迁入 Gateway，因此不得把当前增量描述成完整 Gateway。Gateway 快照不包含 account/chat/user、
消息正文或凭据，也不调用模型或平台。

## 卸载

```sh
dsh plugin --profile web remove dsh-gateway
```

卸载只停止 Gateway 自己的生命周期并关闭插件日志；原生 DSH Session、Goal、Workspace 以及已经发生的
外部效果不由本插件删除或回滚。
