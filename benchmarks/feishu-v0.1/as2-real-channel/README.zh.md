# AS-2：真实飞书 exact-route 验收

本入口只验证一条真实飞书渠道纵切：最终 `dsh-gateway`/`dsh-feishu` tarball 安装到全新 DSH `web`
profile，经官方飞书 WebSocket/HTTP 接收一个 exact 用户消息，进入原生 DSH Session，交付最终回答，执行
`/feishu`，完成一次原生 DSH Approval 卡片，再投递一个持久 Host notice；随后 dispose、官方卸载、原生
DSH 重启并读回同一 Session。

它不是飞书 Mock，也不使用 benchmark-owned Approval 或 Agent Runtime。为了把渠道效果与模型付费/质量分离，
本 epoch 使用 DSH 自带的 keyless deterministic LLM fixture；因此通过结果只证明真实渠道、DSH 集成、生命周期
和重复效果门，不证明真实模型、内容资源权限、长期重连或 Hermes paired 胜出。

## 安全合同

- 未设置精确授权短语时，入口只读取授权变量，不读取 App ID、Secret、chat/user，不加载执行模块，不发请求；
- 所有平台身份、Secret、DSH 源码和 run root 都在授权后验证；公开报告只保留身份哈希；
- EvoForge 与 DSH 必须是 clean worktree，DSH HEAD 必须等于 manifest 固定 revision；
- 每个 exact run 在任何真实效果前写入私有状态；若进程在非终态退出，同一 run root 不会自动重放；
- Gateway 出现 ingress/outbound `uncertain` 或 `failed`、challenge 重复进入 Session、Approval 不是
  `allowed-once`、卸载后 Session 不可读，均判失败；
- terminal `result.json` 按 revision、manifest、App/route hash 与 chat kind 复用；Adapter 必须从真实入站事件
  观测到与声明一致的 `direct`/`group`，不能用私聊冒充群聊或复用另一条路线的结果。

## 前置飞书配置

在飞书开发者后台为一个测试 App 启用机器人、长连接事件订阅 `im.message.receive_v1`、发送消息和卡片回调；
把机器人加入目标私聊或群聊。第一次建议先用 `dsh-feishu` pairing mode 取得 exact `conversationId` 与
`userId`，人工审查后再执行本入口。不要使用生产群或不可接受测试消息的账号。

## 执行

选择一个尚未使用、位于 DSH/EvoForge 仓库之外的绝对 run root。直接私聊和群聊是两个独立 epoch，必须分别
设置 `direct`/`group` 并各跑一次：

```sh
export DSH_FEISHU_REAL_CHANNEL_APPROVED=I_APPROVE_REAL_FEISHU_CHANNEL_EFFECTS
export DSH_FEISHU_APP_ID='cli_...'
export DSH_FEISHU_APP_SECRET='...'
export DSH_FEISHU_CONVERSATION_ID='oc_...'
export DSH_FEISHU_USER_ID='ou_...'
export DSH_FEISHU_CHAT_KIND='direct'
export DSH_FEISHU_DSH_SOURCE_DIR='/absolute/path/to/deepseek-harness'
export DSH_FEISHU_REAL_CHANNEL_RUN_ROOT='/absolute/private/path/as2-direct-epoch-1'
pnpm benchmark:feishu:as2
```

默认每个人工步骤等待 5 分钟。可用 `DSH_FEISHU_REAL_CHANNEL_TIMEOUT_MS` 调整为 60000–900000
毫秒的规范十进制整数。

入口启动后在 stderr 显示一次性 challenge。使用配置中的 exact 飞书用户/chat 发送它，收到 DSH 回复后发送
`/feishu`，最后在卡片中点击“Allow once”；群聊必须先 `@机器人`，mention 后的正文保持 challenge/Command
不变。stdout 只输出一个 JSON 报告：exit 0 + `status: passed` 才是该
chat kind 的真实通过；exit 2 + `not-run`、exit 1 + `failed` 都不是证据。

如果真实效果阶段超时或进程崩溃，先审计私有 run root、飞书消息和 Gateway 状态。为避免盲重放，不要删除或
篡改原 run；确认外部效果后换一个新的绝对 run root 执行下一 epoch。
