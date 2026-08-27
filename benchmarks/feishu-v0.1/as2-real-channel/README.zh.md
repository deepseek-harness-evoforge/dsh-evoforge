# AS-2：真实飞书 resident pairing 验收

本入口只验证一条真实飞书私聊纵切：最终 `dsh-gateway`/`dsh-feishu` tarball 安装到全新 DSH `web`
profile，Gateway/Adapter 以零预授权飞书 route 常驻。陌生用户先发送任意私聊并从机器人取得 code，Host
把对应的脱敏 pending request 批准到已创建的原生 Workspace/Session；第一条消息不进 Agent，批准后不改
profile、不重连。机器人仍会把 code 返回给用户作为产品兼容路径，但验收器不读取或粘贴该 code。随后
经官方飞书 WebSocket/HTTP 接收 exact 用户消息，进入原生 DSH Session，交付最终回答，执行
`/feishu`，通过官方 agent-scoped `schedule_create` 完成一次 create→dispatch→`user/message`
（`source.kind=plugin`、`source.plugin=schedule`）→同 route
回送，完成一次原生 DSH Approval 卡片，再通过动态 Host route 投递一个持久 notice。Host 随后干净重启；
用户无需重新配对即可再完成一次消息/回复。最后 dispose、官方卸载、原生 DSH 重启并读回同一 Session。

它不是飞书 Mock，也不使用 benchmark-owned Approval 或 Agent Runtime。为了把渠道效果与模型付费/质量分离，
本 epoch 使用 DSH 自带的 keyless deterministic LLM fixture；因此通过结果只证明真实渠道、DSH 集成、生命周期
和重复效果门，不证明真实模型、内容资源权限、长期重连或 Hermes paired 胜出。

## 安全合同

- 未设置精确授权短语时，入口只读取授权变量，不读取 App ID、Secret，不加载执行模块，不发请求；
- 所有平台身份、Secret、DSH 源码和 run root 都在授权后验证；公开报告只保留身份哈希；
- EvoForge 与 DSH 必须是 clean worktree，DSH HEAD 必须等于 manifest 固定 revision；
- 每个 exact run 在任何真实效果前写入私有状态；若进程在非终态退出，同一 run root 不会自动重放；
- Gateway 出现 ingress/outbound `uncertain` 或 `failed`、challenge 重复进入 Session、Approval 不是
  `allowed-once`、卸载后 Session 不可读，均判失败；
- terminal `result.json` 按 revision、manifest 与 App hash 复用；route hash 只能在 Host 批准后由动态 grant 形成，
  公开结果不包含 conversation/user/code。Adapter 必须从真实入站事件观测到 `direct`，群聊不在本 epoch 范围。
- 当前 epoch 为 `as2-feishu-resident-pairing-epoch-3`；终态解码器要求关闭的十三项 observation 全部存在，
  `passed` 还要求全部为真。静态 route epoch、缺 Schedule、缺重启消息或损坏结果不能阻止新执行。

## 前置飞书配置

在飞书开发者后台为一个测试 App 启用机器人、长连接事件订阅 `im.message.receive_v1`、发送消息和卡片回调；
把机器人加入测试账号的私聊。无需预查 `conversationId` 或 `userId`；它们只在 Gateway pending request 内
出现并由 Host 动态批准。不要使用生产群或不可接受测试消息的账号。

## 执行

选择一个尚未使用、位于 DSH/EvoForge 仓库之外的绝对 run root。本 epoch 只验收 direct 私聊：

```sh
export DSH_FEISHU_REAL_CHANNEL_APPROVED=I_APPROVE_REAL_FEISHU_CHANNEL_EFFECTS
export DSH_FEISHU_APP_ID='cli_...'
export DSH_FEISHU_APP_SECRET='...'
export DSH_FEISHU_DSH_SOURCE_DIR='/absolute/path/to/deepseek-harness'
export DSH_FEISHU_REAL_CHANNEL_RUN_ROOT='/absolute/private/path/as2-resident-epoch-3'
pnpm benchmark:feishu:as2
```

默认每个人工步骤等待 5 分钟。可用 `DSH_FEISHU_REAL_CHANNEL_TIMEOUT_MS` 调整为 60000–900000
毫秒的规范十进制整数。

入口启动后先提示给机器人发送任意私聊；Gateway 把陌生私聊保存为脱敏 pending request，验收器从 Host
读取唯一匹配当前 App 的 `requestId` 并走生产 `approvePairingRequestForSession` 门批准，不从 stdin 读取
配对码，也不把平台身份暴露给验收器。批准后再发送 stderr 显示的 exact challenge，收到 DSH 回复后发送
`/feishu`；随后等待一条由官方 DSH Schedule 到期 turn 回送的
消息，最后在卡片中点击“Allow once”。收到持久 notice 后，验收器会干净重启 Host，并要求再发送一个 exact
文本以证明无需重新配对。Schedule 由验收器通过官方 Tool 创建，不要求用户用自然语言解释时间；它只证明原生
Schedule 与真实渠道组合，不证明真实模型时间理解。stdout
只输出一个 JSON 报告：exit 0 + `status: passed` 才是该
chat kind 的真实通过；exit 2 + `not-run`、exit 1 + `failed` 都不是证据。

如果真实效果阶段超时或进程崩溃，先审计私有 run root、飞书消息和 Gateway 状态。为避免盲重放，不要删除或
篡改原 run；确认外部效果后换一个新的绝对 run root 执行下一 epoch。
