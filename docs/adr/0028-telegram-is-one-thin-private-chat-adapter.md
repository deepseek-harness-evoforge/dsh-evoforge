# ADR-0028：Telegram 是一个薄型单私聊 Adapter

> Gateway 接缝相关决策已由 ADR-0049 取代；平台协议、保守外部效果和不另造 DSH 权威的决定继续有效。

## 背景

Hermes 的个人助理优势来自常驻消息入口、Cron 回送和渠道内审批。DSH 已拥有 Agent、Session、
Commands、Approval 与 session-local Schedule，但没有 Telegram 外部入口。复制一个统一 Gateway
会提前引入平台注册表、动态路由、第二套 Session 映射和宽生命周期，而当前只有一个待验证场景。

## 决策

新增独立可删除的 `dsh-telegram` Bundle。首版配置只允许一个 Bot token 环境变量、一个 exact
private `chat_id`、一个 exact `user_id` 和一个既有 root `agent_id`。这里的 `agent_id` 是 Agent
配置中稳定 `sessionId` 所形成的运行时共享 Agent/Session id，不是声明式配置条目的 label。这组
静态配置就是秘密读取与向该私聊发送消息的明确部署策略；模型不能修改目标。

插件通过支持的 DSH seam 完成一个结果：

- Telegram `getUpdates` 长轮询由 Cordis effect 拥有，dispose 会 abort 在途请求并等待退出；
- 普通文本使用确定性 Message identity 进入既有 Agent 的 durable inbox；重放先查询 Session 事实；
- 已知 slash command 复用 `ctx.commands.execute()`，不发送给模型；
- 路由该固定 Agent 的每个已完成 turn 的最终 assistant text，包括 Telegram、Goal、Schedule 与
  其他原生 continuation；
- `approval/request` 使用一次性 inline callback 回答，重复、过期或错误身份一律拒绝；
- 外发 journal 使用 DSH Storage Domain；Agent turn 只保存引用，重启从 Session 重建文本；原生
  Command 的有界直接响应随记录保存，以便重试时不重新执行命令。两类记录都只附带状态、attempt、
  Telegram message id 和有界错误，不复制 Prompt 或 Transcript；终态历史有硬容量上限，长期
  运行时只淘汰最旧终态，不删除 live delivery；Command 只保留一个单调 accepted update checkpoint。

不把 out-of-tree delivery event 追加到 Session。当前 DSH 的持久事件 catalog 无法识别插件私有
Session event，而公开 `Session.append()` 也不能为它声明 `ignorable`；把外发 journal 放进 Session
会使插件卸载后的原生 Session 恢复不再可靠。独立 Storage Domain 是受支持、可删除且不污染原生
会话事实的边界，不是第二套 Session。

不建立公共 Channel Service。等第二个真实 Adapter 证明相同变化点后再提取 seam。

## 外部效果与恢复

Telegram 没有客户端幂等键或历史查询接口，因此不能诚实承诺 exactly-once：

1. `prepared` 先 durable，再进入发送；
2. `sending` 先 durable，再调用 `sendMessage`；
3. 成功响应后保存 Telegram `message_id`；
4. Telegram 明确拒绝且证明未发送的限流可按 `retry_after` 有界重试；
5. transport timeout、连接中断、无效响应或 `sending` 状态下崩溃一律变成 `uncertain`，不自动重发；
6. `/telegram` 让用户查询 `delivered | retrying | uncertain | failed`，人工可以回到原 Session 决定。

该取舍优先保证“不会因自动重试重复对外发消息”。版本回滚只停止未来路由，不能撤回已发 Telegram
消息。

## KV Cache 契约

`dsh-telegram` 不注册 Tool、Skill、system prompt 或模型可见状态。Telegram 输入与原生 Web 输入
一样，只在用户实际发送后追加普通消息；Schedule 继续使用其原生 framing。Approval 卡片、offset、
重试和 delivery journal 全部留在 host plane。因此无活动时增加 0 token，同一 Session 的既有
composition fingerprint 不变。

## 非目标

群组/频道/topic、媒体、流式草稿、多租户、多 Agent 路由、Webhook server、通用 Gateway、第二套
Schedule/Approval/Session，以及不确定外部效果的自动重试均不进入首版。
