# dsh-feishu

`dsh-feishu` 是 DeepSeek Harness 的飞书薄 Adapter Bundle。它不创建 Agent Runtime、Session、Goal、权限系统、网站、Webhook server 或 daemon；官方飞书 SDK 的 WebSocket 长连接由 DSH Cordis lifecycle 持有，所有入站授权、配对和会话归属由常驻 `dsh-gateway` 决定。同一个 npm 包还带一个 DSH Web Client Module，只显示已绑定 Session 的只读飞书健康视图；配对批准位于 `dsh-gateway` Host 控制面。

## 安装

当前未发布 registry 版本。先打包 Gateway 与 Adapter，再使用 DSH 官方 profile 命令安装：

```sh
PACK_DIR="$(mktemp -d)"
pnpm --filter dsh-gateway pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-feishu pack --pack-destination "$PACK_DIR"
dsh plugin --profile web add "$PACK_DIR"/dsh-gateway-*.tgz "$PACK_DIR"/dsh-feishu-*.tgz
dsh --profile web --dump-config
```

两个 Bundle 默认 disabled。部署者先在飞书开发者后台启用机器人能力、订阅 `im.message.receive_v1` 与卡片回调所需权限并选择长连接。

## 第一次连接：不手工查 ID

不知道 `chat_id`/`open_id` 时，在 profile 中启用空 Gateway 和 resident pairing mode：

```yaml
- id: evoforge-gateway
  name: dsh-gateway
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

启动唯一的 DSH Web Host 后，Adapter 立即连接并保持常驻。用户只需在飞书私聊机器人发送任意消息；
Gateway 在 Agent 之前消费首条消息并由机器人回复 10 位配对码。管理员打开 DSH Web 原生“控制台”中的“渠道”
Surface，
确认当前 Workspace/Session，粘贴 code 并点击“批准飞书配对”。批准原子写入 Gateway Storage Domain，
用户发送下一条消息即可进入原生 DSH Session；不改 profile、不切 mode、不重启。

群聊不会发配对码；过期、重放、跨 App 歧义、没有 live Session 或 Workspace ownership/cwd 不匹配都会
fail closed。code 明文不落盘，首条消息和附件不进入 Agent。没有 `/feishu-pair` Session Command，也没有
临时 listener、反向短语、静态 YAML 复制或浏览器后台轮询。

## 正常运行配置

配对输出等价于以下 exact Gateway route 结构：

```yaml
- id: evoforge-gateway
  name: dsh-gateway
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
    contentPermissions: []
```

`accountId` 必须等于环境中的 App ID；App Secret 只从部署环境读取。一个 Adapter 实例可列出同一个
App 的多个 exact route。普通 routes 模式不接受 wildcard 或模型选择的 Workspace；它是预配置 route 与
独立内容权限的可选方式，不是 resident pairing 成功后的迁移步骤。

## 文档、知识库、云盘和多维表格

routes mode 可按部署最小权限独立启用四项内容读取；默认全部关闭：

```yaml
config:
  routeIds: [feishu-personal]
  appIdEnv: DSH_FEISHU_APP_ID
  appSecretEnv: DSH_FEISHU_APP_SECRET
  contentPermissions:
    - document-read
    - wiki-read
    - drive-metadata-read
    - bitable-records-read
  maxContentChars: 20000
  maxBitableRecords: 20
```

这四项不是 Gateway 能力。`dsh-feishu` 只为 exact Agent 注册一个稳定的原生
`feishu_content_read` Tool；每次调用必须经过 DSH Tool policy 和原生 Approval，缺少 Approval provider 时
fail closed。权限、Agent、参数或审批任一不满足时不会调用飞书。文档/Wiki 正文按字符上限截断，Drive 只读
脱敏元数据，Bitable 最多读取一页受限记录；输入 resource token、provider metadata URL 和 owner identity
不进入 Tool 结果。正文或表格字段本身仍是经审批进入当前 Session 的用户内容。

当前 Session 已形成 request header 后不会新增 Tool；配置新权限只影响未来 Session。撤销权限时，为保持
schema/cache 稳定，旧 Session 仍保留同名 schema，但每次执行都会被拒绝。pairing mode 禁止启用内容权限。
部署配置不是飞书平台授权的替代：App scope、tenant 和 exact resource membership 还必须在飞书侧满足。

## 运行合同

- Gateway 持有 endpoint → Workspace/Session/Agent、原生 Command admission 和持久 ingress 幂等；
- Adapter 从官方 message-resource API 下载入站图片，先对整批执行 DSH 数量、单图、总字节、格式和像素
  校验，再由 `ctx.attachments` 保存为内容寻址 `ImageAttachmentRef`；只有原生引用进入 Gateway/Session，
  飞书 `fileKey` 不进入模型可见消息或 Session event；图片消息不会被当作 slash command；
- Gateway 持有普通文本 `turn/response/notice` 的有界出站 journal、幂等键、按 App account 串行、
  明确 429 有界重试和保守崩溃恢复；
- Adapter 只持有官方 WebSocket/HTTP 协议、平台发送映射、卡片和一次性 DSH Approval UI，不再维护第二套
  Delivery Store 或 retry worker；Approval 卡片沿 exact reply/thread 发送，并把 nonce 绑定到平台返回的
  card message id、exact chat 和 exact operator，只有首个完全匹配的 action 生效，错误卡片、错误身份、重放、
  abort、disable、reload 或 remove 均不能留下可消费的旧审批；
- Adapter 自动采用部署进程的 `HTTPS_PROXY`/`https_proxy` 或 `ALL_PROXY`/`all_proxy`，并遵守
  `NO_PROXY`/`no_proxy`；代理只绑定到该飞书连接，不修改环境变量或全局 Agent；
- 发送意图先落盘；每次文本发送固定 30 秒 wall-clock 上限并把 Gateway signal 传入官方 HTTP transport；
  明确 429 才有界重试；timeout、传输失败或崩溃中的 `sending` 转为 `uncertain`，不自动重复发送；Approval
  卡片同样组合 30 秒上限、Adapter lifecycle 与原生 request signal；
- 单 route Session 的 Goal/Schedule continuation 可主动投递；create 已完成 Session checkpoint、dispatch 前进程死亡时，Adapter 启动会经静态 Gateway route 恢复 exact Session，官方 Schedule 处理 overdue，并由 durable turn journal 投递一次；后续 Host 启动不重放；多 route Session 的主动目标不明确时 fail closed；host notice 必须显式指定 `routeId`；
- `/feishu` 是原生 DSH Command；Adapter 把 transport lifecycle 的脱敏 observation 注册到 Gateway，它再与
  当前 Session 的权威 outbound 投影共同生成带版本的健康快照。DSH Web 打开面板或人工点击刷新时复用这个 Command，
  不后台轮询，不调用模型，也不显示凭据、chat/user identity、外部 message id 或消息正文；
- V2 健康快照还从 exact Agent 的 Tool registry、Approval seam 和 request header 读取内容就绪状态，逐项
  显示四个部署权限、Tool/Approval 可用性和配置上限；`future-session-only` 明示新能力不会改写当前 Session；
  `platformAccess: not-verified` 明示健康检查没有主动探测飞书 App/资源授权；
- Gateway Web 在零 route 时仍显示 resident Adapter transport/outbound registration，并提供 Host-side code 批准；已绑定 Session 的 `/feishu` 只读健康读取失败会清除旧快照，避免历史 `ready` 冒充当前状态；
- 健康视图区分 `ready`、`busy`、`attention`、`degraded` 与 `stopping`，展示 exact route 名称、官方 WebSocket lifecycle、投递/重试/uncertain/failed 与 pending Approval 计数；已配置内容能力但 Tool/Approval 当前不可用时进入 `attention`，未配置时保持 `disabled`；普通模型请求仍新增 0 Tool、0 Skill、0 Prompt section；
- disable、reload 或 remove 会注销 handler、取消 pending Approval、释放 Gateway outbound registration
  并断开官方长连接；Gateway 自己负责关闭公共 Storage Domain。

当前用户支持基线是 DSH `dsh-v0.1.2-alpha.5`（revision
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`）。其 AttachmentStore、LLM ContentBlock 和 DeepSeek Files 路径
仍为 image-only；入站使用整批 `saveImages()`，
并保留图片规范化产生的 `originalDimensions`。
因此本插件当前没有把飞书普通文件、音频或视频宣称为已完成：不得把外部
`fileKey`、URL、base64 或伪造 file block 写入 Session。文档、知识库、云盘元数据和多维表格读取已有
assembled DSH 自动化证据，但真实飞书 App scope、资源权限拒绝与真实内容仍待验收。

Schedule 的进程恢复证据覆盖 durable create 后、follow-up/dispatch 前的 `SIGKILL`，以及第一次平台效果已发生、
包含 dispatch 的 Session batch 仍未 durable 时的反向窗口。后者恢复时会重跑非 durable 模型 turn，但
append-only Session 顺序让 turn 号保持不变，Gateway 复用同一 durable intent，不第二次调用平台。官方 DSH
Schedule 仍明确保留该窗口中的模型重复；本插件不复制 Schedule 状态，也不宣称模型、token、时延或成本
exactly-once。

真实 exact-route 渠道验收使用仓库阶段入口 `pnpm benchmark:feishu:as2`，详见
[AS-2 说明](../../benchmarks/feishu-v0.1/as2-real-channel/README.zh.md)。它只在显式授权后从最终
`dsh-gateway`/`dsh-feishu` tarball 启动生产飞书 transport，并把入站、回复、`/feishu`、一次性 Approval、
官方 DSH Schedule create/dispatch/插件来源 `user/message` 到同 route 回送、持久 notice、dispose、官方卸载和原生
Session readback 设为 hard gate。当前 epoch-2 的关闭终态还必须包含全部十一项 observation；旧 epoch 或遗漏
Schedule 的报告不能复用。当前无凭据，真实状态是 `NOT_RUN`；合同或 fake transport 通过不能替代真实结果。

官方协议依据：[飞书事件订阅概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)、[官方 Node SDK](https://github.com/larksuite/node-sdk)、[发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)、[获取消息中的资源文件](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=get&project=im&resource=message.resource&version=v1)、[文档 raw content](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=raw_content&project=docx&resource=document&version=v1)、[知识库节点](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=get_node&project=wiki&resource=space&version=v2)、[云盘元数据](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=batch_query&project=drive&resource=meta&version=v1)、[多维表格记录](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=search&project=bitable&resource=app.table.record&version=v1)。
