# dsh-gateway

`dsh-gateway` 是默认关闭的 DeepSeek Harness 原生 Cordis Bundle，也是 Telegram、飞书等渠道
Adapter 共用的 Host 接缝。它把部署者声明的 external account/conversation/thread/user 精确绑定到一个
原生 DSH Workspace、Session 和 Agent preset，并负责进入 DSH 前的文本/原生图片引用标准化、路由、幂等，以及普通文本
出站意图的持久化、串行投递和崩溃不确定性。
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
- 已注册 slash command 只走 DSH `commands.execute()`；普通文本、图片或图文以稳定 MessageId 进入原生 Agent inbox；
- Gateway 只接收已经由 Adapter 下载、经 `ctx.attachments` 完整校验并持久化的 `ImageAttachmentRef`；平台
  `fileKey`、URL、base64 和本地路径不得跨越该接缝；含图片的输入永不解释为 slash command；
- 以 DSH Storage Domain 保存有界 ingress identity/status/Command 结果，不保存消息正文；
- 同一外部事件只执行一次；内容或归属漂移被拒绝；纯文本沿用既有摘要，图文使用包含每个原生附件引用的
  版本化 canonical 摘要，升级不会把已完成纯文本事件误判为漂移；effect 边界崩溃标记为 `uncertain`，不盲目重放；
- Adapter 通过小型 `registerTextAdapter()` 接口注册 exact platform account 和显式 routeIds；Gateway 逐条
  校验 route 归属后先持久化
  route-scoped `turn/response/notice` 意图，再按 Adapter/account 串行调用平台发送；
- 同一 route + intent key 的重复提交不会重复发送，内容或目标漂移 fail closed；最终 turn 可在
  `turn-stopping` 时先落盘，但必须观察到原生 `turn/end` 后才允许外发；
- 只有 Adapter 明确证明的 pre-acceptance rate limit 才能按 `maxAttempts/maxRetryAfterMs` 有界重试；
  模糊返回、抛错或崩溃中的 `sending` 一律进入 `uncertain`，禁止自动重放；
- 每个 Adapter 注册必须声明 `sendTimeoutMs`；Gateway 将 timeout 与 Cordis lifecycle cancellation 组合，
  并主动 race Adapter Promise。即使平台代码忽略 signal，超时、disable、reload 或 remove 也会把 durable
  `sending` 终结为 `uncertain`，不会无限阻塞 disposer 或自动重发；
- 有界 outbound journal 只淘汰最旧终态，活跃记录占满时拒绝新意图；普通文本、reply identity 和外部
  message id 留在 Gateway Storage Domain，健康投影不暴露这些内容；
- `healthSnapshot()` 从 Gateway 自有 route、原生 Agent 注册表和 ingress journal 生成脱敏权威快照，支持
  exact route 子集、生命周期、live Session、ingress 状态，以及 outbound 注册、排队、投递状态和最近意图元数据；
- Adapter 通过独立 `registerTransport()` 上报 exact route 所属的 transport kind、`connecting/ready/degraded/stopping`
  和有界时间事实；Gateway 校验 account/route 所有权、拒绝重复注册与时间倒退，并按 route 子集聚合；
- Cordis dispose 等待在途入站、释放 Gateway 创建的 Agent handle，并关闭自己的日志。

Telegram 和飞书已经迁入同一个 outbound 接缝，并删除了各自重复的 Delivery Store/worker。网络鉴权、
SDK/WebSocket/polling、平台事件解析、实际平台发送、卡片和 Approval UI 仍属于 Adapter。Gateway 当前提供
共同的持久意图、幂等、按 account 串行和明确限流响应策略，不声称全局 token bucket、平台配额推断或
exactly-once。Telegram long-poll 与飞书 WebSocket 的 transport 聚合已完成；同包官方 DSH Client Module
通过只读生成式 Remote 在原生 DSH Web Control Center 的“渠道”Surface 统一展示 lifecycle、route、live Session、transport 与投递聚合。面板
只在打开/人工刷新时读取 Host；读取失败清除旧快照，Host 恢复后可重新读取。Gateway 快照不包含
account/chat/user、消息正文、外部 message id、错误正文或凭据，也不调用模型或平台。

当前固定的 DSH attachment v1 只定义 PNG/JPEG/WebP/GIF 栅格图片。Gateway 不发明通用 file block；飞书
普通文件、音频和视频必须等待 DSH 官方持久附件/消息契约或由独立、明确授权的内容能力处理，不能以图片
引用或消息正文占位冒充已经交付。

## 卸载

```sh
dsh plugin --profile web remove dsh-gateway
```

卸载只停止 Gateway 自己的生命周期并关闭插件日志；原生 DSH Session、Goal、Workspace 以及已经发生的
外部效果不由本插件删除或回滚。
