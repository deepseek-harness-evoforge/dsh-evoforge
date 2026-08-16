# AS-1 首个通用助理工作流选择

> 调研快照：2026-08-17；状态：首片 implemented，尚未证明市场占有率或优于 Hermes

## 结论

首个 AS-1 选择 **一个 Telegram 私聊与一个既有 DSH root Agent 的双向连接**，包名为
`dsh-telegram`。它不是通用 Gateway：首版只支持一个 Bot、一个明确允许的私聊、纯文本、原生
DSH Commands、原生 Approval，以及同一 Agent 的 Goal、Schedule 等原生后续轮次。

功能测试句：

> 对希望离开浏览器仍能使用个人 Agent 的 DSH 用户，`dsh-telegram` 把一个明确允许的 Telegram
> 私聊输入变成同一个原生 DSH Agent 的连续会话，并把最终回答、定时提醒和一次性审批送回该私聊。

即使 DSH 完全符合文档，这个结果仍有价值。DSH 原生 Schedule 明确是 `session-local`：只在原
Session 的 live Agent 中产生后续 turn，没有外部通知渠道。插件增加的是外部触达和人机入口，
不是修复 Schedule。

## 为什么先验证 Telegram

- 当前 DSH Discussion 没有足够的消息渠道样本，不能声称“大多数 DSH 用户需要 Telegram”。
- Hermes 证明“常驻 Agent + 消息渠道 + Cron + 审批”是可用的个人助理产品闭环；但其统一
  Gateway、Cron、Session 和多平台生命周期过宽，不适合作为首个 DSH 扩展形态。
- Telegram Bot 只需要一个 Bot token 和 HTTPS API，不要求公网回调、OAuth Web UI 或邮件服务器；
  官方 `getUpdates` 支持长轮询并用单调 `update_id` 恢复顺序，适合单机常驻首片。
- Telegram 官方 `sendMessage` 返回外部 `message_id`，inline keyboard callback 可承载 DSH 的
  一次性 Approval。首片不用引入第三方 SDK。
- Email 的线程、IMAP/SMTP、附件和供应商差异，Slack/Discord 的 workspace/app 权限与多线程路由，
  Calendar 的时区、冲突和不可逆写入，都需要更宽的权限和状态面。它们保留为后续独立 Adapter，
  不进入首片。

这些理由只支持“开发成本低、闭环完整、值得先测”，不证明真实采用率。进入 `better` 声明前仍需
真实用户安装、故障注入和与 Hermes 的 paired benchmark。

## 官方协议事实

- Bot API 是基于 HTTPS 的接口；token 是访问凭据，必须作为秘密处理：
  [Telegram Bot API](https://core.telegram.org/bots/api#authorizing-your-bot)。
- `getUpdates` 与 Webhook 互斥；更新最多保留 24 小时；确认 offset 必须大于已处理
  `update_id`，官方明确要求每批响应后重算 offset：
  [Getting updates](https://core.telegram.org/bots/api#getting-updates)。
- `sendMessage` 的文本上限为 4096 字符，并返回已发送的 `Message`：
  [sendMessage](https://core.telegram.org/bots/api#sendmessage)。
- callback button 的 `callback_data` 上限为 64 bytes；按键后必须调用 `answerCallbackQuery`：
  [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton)、
  [CallbackQuery](https://core.telegram.org/bots/api#callbackquery)。

## 首片验收结果

1. 只接受配置中的 exact private `chat_id` 与 `user_id`；其他 update 不进入 DSH。
2. Telegram update 映射成确定性 DSH Message identity；进程重启或 offset 重放不产生第二个 turn。
3. 已知 DSH Command 在 host plane 执行；普通文本进入同一个带稳定 `sessionId` 的 root Agent；配置
   中 `agentId` 指运行时共享 Agent/Session id，不是声明式 Agent label。
4. 把该专用 Agent 的每个完成 turn 最终文本送回 Telegram，包括 Telegram、Goal、Schedule 与其他
   原生 continuation；若用户不希望 Web turn 也外发，应为 Telegram 使用专用 Agent。
5. DSH Approval 通过一次性 inline buttons 回答；过期、非允许用户和重复 callback fail closed。
6. 外发先在独立 DSH Storage Domain 记录 durable intent；明确未发送的限流失败可有界重试，网络
   结果不确定或发送中崩溃不自动重发，并在 `/telegram` 状态中明确呈现；终态记录有硬容量上限，
   Command admission 只保留单调 checkpoint，不向 Session 追加卸载后不可恢复的插件私有事件。
7. 普通 Session 的 Prompt、Tool、Schema、Skill catalog 与顺序完全不变；插件增加 0 model token。
8. Bundle 可安装、dump、boot、dispose、remove；卸载后原生 DSH Session、Goal 和 Schedule 仍可用。

实现与自动化证据见 [AS-1 Telegram 单私聊 Adapter](../evidence/as-1-telegram-private-chat.zh.md)。这些
证据只支持 `implemented`，不支持真实采用率、生产可靠性或 `better than Hermes` 声明。

## 非目标

- 群聊、频道、topic、附件、语音、富文本流式草稿；
- 多 Bot、多 Chat、多 Agent 动态路由；
- Telegram 内创建新的 Agent preset 或权限策略；
- 第二套 Session、Schedule、Goal、Approval、Memory 或通用 Channel Service；
- 对结果不确定的外部发送宣称 exactly-once；
- 自动读取任意环境变量、让模型选择 token、chat 或目标用户。
