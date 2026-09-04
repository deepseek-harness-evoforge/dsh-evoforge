# AS-1：真实 Telegram Bot resident pairing 验收契约

本目录定义一条真实 Telegram 私聊验收，而不是 Telegram Mock 或旧的 Hermes 本地回放：最终
`dsh-gateway`/`dsh-telegram` Bundle 安装到全新 DSH `web` profile，常驻 Adapter 通过官方 Bot API
长轮询启动；陌生用户首条私聊得到一次性配对码且不进入 Agent，管理员在 DSH Web 的原生 Gateway
控制面批准脱敏 pending request，用户下一条 exact challenge 才进入原生 DSH Session。随后验收
重复 update 不产生第二个 turn，原生 DSH Approval 只允许一次，Host 干净重启后无需重新配对仍可
完成消息/回复，最后卸载插件并读回原生 Session。

这不是 Hermes paired benchmark，也不证明模型质量、群聊、媒体、Webhook、长期运行或完整上位替代。
`manifest.json` 固定可构建的 DSH alpha.5 支持 revision，同时记录每次开发前审计到的最新 DSH rc.1；
最新 master 的上游构建缺陷不能被本验收器修改或掩盖。

## 零副作用安全合同

- 未设置精确授权短语时，只读取 `DSH_TELEGRAM_REAL_CHANNEL_APPROVED`；不会读取 Bot token、账户或路径，
  不加载执行模块，也不会发起 Telegram 请求。
- 授权后才校验 token、官方 API 地址、DSH 源码目录和仓库外隔离 run root；公开报告只保留账户哈希，
  不写入 token、Telegram chat/user id 或配对码。
- EvoForge 与 DSH 必须是 clean worktree；任何终态报告必须匹配 manifest、两套 DSH revision 和账户哈希。
- 所有 terminal observations 缺一项、Gateway 出现 `uncertain`/`failed`、首条消息进入 Agent、重复 update
  产生重复 turn、Approval 不是 `allowed-once`、重启需重新配对或卸载后 Session 不可读，都判失败。
- 发生崩溃或超时不得盲目重放；先审计私有 run root、Bot 消息和 Gateway journal，再使用新的隔离 run root。

## 当前入口状态

`contract.ts` 和 `contract.test.ts` 已提供外部效果前的严格预检、脱敏 ready 报告与终态报告解码器。
`run.ts` 当前是安全预检入口：无授权时退出码 `2` 并输出 `not-run`；即使环境中存在完整 token，也不会
自动启动真实 Bot，直到完整的人机交互执行器和 release gate 被显式接入。这是防止误把导出的 token 变成
外部副作用的故意门禁，不是“真实 Telegram 已通过”的声明。

```sh
pnpm benchmark:telegram:as1:check
```

真实执行器接入后，才允许在仓库外创建新的 run root，并显式设置：

```sh
export DSH_TELEGRAM_REAL_CHANNEL_APPROVED=I_APPROVE_REAL_TELEGRAM_CHANNEL_EFFECTS
export DSH_TELEGRAM_BOT_TOKEN='123456789:...'
export DSH_TELEGRAM_ACCOUNT_ID='personal-bot'
export DSH_TELEGRAM_DSH_SOURCE_DIR='/absolute/path/to/deepseek-harness'
export DSH_TELEGRAM_REAL_CHANNEL_RUN_ROOT='/absolute/private/path/as1-telegram'
pnpm benchmark:telegram:as1
```

生产 API 只接受 `https://api.telegram.org`；本契约不接受 loopback 或自定义代理作为“真实 Bot”证据。
