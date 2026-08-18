# dsh-feishu

`dsh-feishu` 是 DeepSeek Harness 的飞书薄 Adapter Bundle。它不创建 Agent Runtime、Session、Goal、权限系统、网站、Webhook server 或 daemon；官方飞书 SDK 的 WebSocket 长连接由 DSH Cordis lifecycle 持有，所有入站身份和会话归属由 `dsh-channel-router` 静态决定。同一个 npm 包还带一个 DSH Web Client Module：pairing mode 显示首次连接向导，routes mode 显示当前 Session 的只读飞书健康视图。

## 安装

当前未发布 registry 版本。先打包 Router 与 Adapter，再使用 DSH 官方 profile 命令安装：

```sh
PACK_DIR="$(mktemp -d)"
pnpm --filter dsh-channel-router pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-feishu pack --pack-destination "$PACK_DIR"
dsh plugin --profile web add "$PACK_DIR"/dsh-channel-router-*.tgz "$PACK_DIR"/dsh-feishu-*.tgz
dsh --profile web --dump-config
```

两个 Bundle 默认 disabled。部署者先在飞书开发者后台启用机器人能力、订阅 `im.message.receive_v1` 与卡片回调所需权限并选择长连接。

## 第一次连接：不手工查 ID

不知道 `chat_id`/`open_id` 时，先在 profile 中启用空 Router 和 setup-only pairing mode：

```yaml
- id: evoforge-channel-router
  name: dsh-channel-router
  disabled: false
  config:
    routes: []

- id: evoforge-feishu
  name: dsh-feishu
  disabled: false
  config:
    mode: pairing
    routeIds: []
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
```

启动唯一的 DSH Web Host，打开准备绑定的 Workspace/Session，点击侧栏底部的“连接飞书”。向导会生成
两分钟有效的一次性短语；在目标飞书私聊中原样发送，群聊中先 `@机器人` 再发送。回到向导点击
“我已发送，检查连接”，页面会根据当前原生 Workspace、Session、Agent preset 和模型显示完整 exact
route 草案；复制、审查并写回 profile，把 pairing mode 替换为普通 routes 配置后重启 DSH。

命令仍是同一 Host 能力的备用入口：依次运行 `/feishu-pair start`、`/feishu-pair status`，必要时运行
`/feishu-pair cancel`。Web 不新增配对 API、不轮询或复制状态机，只调用这些 Session-scoped Commands。

配对窗口只接受首条完全匹配的高熵短语；其他消息不会进入 Agent，不会自动写 profile、创建 route 或
扩大权限。向导的“取消本次连接”或 `/feishu-pair cancel` 可立即关闭连接，超时、disable、reload 和
remove 也会断开。

## 正常运行配置

配对输出等价于以下 exact Router route 结构：

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

`accountId` 必须等于环境中的 App ID；App Secret 只从部署环境读取。一个 Adapter 实例可列出同一个
App 的多个 exact route。普通 routes 模式不接受 wildcard、模型选择的 Workspace 或动态授权；
setup-only pairing 只输出待审查配置，重启进入 routes 模式后才生效。

## 运行合同

- Router 持有 endpoint → Workspace/Session/Agent、原生 Command admission 和持久 ingress 幂等；
- Adapter 只持有官方 WebSocket 协议、文本/卡片收发、一次性 DSH Approval UI 和有界 StorageDomain 出站 journal；
- Adapter 自动采用部署进程的 `HTTPS_PROXY`/`https_proxy` 或 `ALL_PROXY`/`all_proxy`，并遵守
  `NO_PROXY`/`no_proxy`；代理只绑定到该飞书连接，不修改环境变量或全局 Agent；
- 发送意图先落盘；明确 429 才有界重试；传输失败或崩溃中的 `sending` 转为 `uncertain`，不自动重复发送；
- 单 route Session 的 Goal/Schedule continuation 可主动投递；多 route Session 的主动目标不明确时 fail closed；host notice 必须显式指定 `routeId`；
- `/feishu` 是原生 DSH Command；它从当前 Session 的 Host lifecycle 与持久 journal 生成带版本、脱敏的健康快照。DSH Web 打开面板或人工点击刷新时复用这个 Command，不后台轮询，不调用模型，也不显示凭据、chat/user identity 或消息正文；
- 若同一部署暂时并存 setup-only 与 routes 实例，已绑定 Session 的 `/feishu` 健康入口优先于全局 `/feishu-pair`；读取失败会清除旧快照，避免历史 `ready` 冒充当前状态；
- 健康视图区分 `ready`、`busy`、`attention`、`degraded` 与 `stopping`，展示 exact route 名称、官方 WebSocket lifecycle、投递/重试/uncertain/failed 与 pending Approval 计数；普通模型请求仍新增 0 Tool、0 Skill、0 Prompt section；
- disable、reload 或 remove 会注销 handler、取消 pending Approval、停止 worker、关闭 StorageDomain 并断开官方长连接。

官方协议依据：[飞书事件订阅概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)、[官方 Node SDK](https://github.com/larksuite/node-sdk)、[发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。
