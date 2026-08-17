# dsh-feishu

`dsh-feishu` 是 DeepSeek Harness 的飞书薄 Adapter Bundle。它不创建 Agent Runtime、Session、Goal、权限系统、网站、Webhook server 或 daemon；官方飞书 SDK 的 WebSocket 长连接由 DSH Cordis lifecycle 持有，所有入站身份和会话归属由 `dsh-channel-router` 静态决定。

## 安装

当前未发布 registry 版本。先打包 Router 与 Adapter，再使用 DSH 官方 profile 命令安装：

```sh
PACK_DIR="$(mktemp -d)"
pnpm --filter dsh-channel-router pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-feishu pack --pack-destination "$PACK_DIR"
dsh plugin --profile web add "$PACK_DIR"/dsh-channel-router-*.tgz "$PACK_DIR"/dsh-feishu-*.tgz
dsh --profile web --dump-config
```

两个 Bundle 默认 disabled。部署者先在飞书开发者后台启用机器人能力、订阅 `im.message.receive_v1` 与卡片回调所需权限并选择长连接，再配置 exact Router route：

```yaml
- id: evoforge-channel-router
  name: dsh-channel-router
  disabled: false
  config:
    routes:
      - id: feishu-personal
        adapter: feishu
        accountId: cli_xxxxxxxxxxxxx
        conversationId: oc_xxxxxxxxxxxxx
        userId: ou_xxxxxxxxxxxxx
        workspaceId: 11111111-1111-4111-8111-111111111111
        sessionId: feishu-personal-main
        agentPreset: standard
        provider: deepseek-official
        model: deepseek-v4-flash

- id: evoforge-feishu
  name: dsh-feishu
  disabled: false
  config:
    routeIds: [feishu-personal]
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
```

`accountId` 必须等于环境中的 App ID；App Secret 只从部署环境读取。一个 Adapter 实例可列出同一个 App 的多个 exact route，不接受 wildcard、模型选择的 Workspace 或运行时配对。

## 运行合同

- Router 持有 endpoint → Workspace/Session/Agent、原生 Command admission 和持久 ingress 幂等；
- Adapter 只持有官方 WebSocket 协议、文本/卡片收发、一次性 DSH Approval UI 和有界 StorageDomain 出站 journal；
- 发送意图先落盘；明确 429 才有界重试；传输失败或崩溃中的 `sending` 转为 `uncertain`，不自动重复发送；
- 单 route Session 的 Goal/Schedule continuation 可主动投递；多 route Session 的主动目标不明确时 fail closed；host notice 必须显式指定 `routeId`；
- `/feishu` 是原生 DSH Command；普通模型请求新增 0 Tool、0 Skill、0 Prompt section；
- disable、reload 或 remove 会注销 handler、取消 pending Approval、停止 worker、关闭 StorageDomain 并断开官方长连接。

官方协议依据：[飞书事件订阅概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)、[官方 Node SDK](https://github.com/larksuite/node-sdk)、[发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。
