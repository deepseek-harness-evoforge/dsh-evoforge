# ADR-0041：Evolve Attention 是一个 Telegram 窄桥接插件

## 背景

`dsh-evolve` 已把模糊 Candidate 与生成的 Evaluator Draft 放入旁路审阅，Commands/Web 也能读取并
执行既有控制动作；`dsh-telegram` 已把一个部署授权的固定私聊连接到一个稳定 DSH Agent，并提供
耐久投递与原生 Command。两者之间仍缺一跳：后台结果已经需要人类决定，但用户只有主动打开 Web
或执行 `/evolve` 才会发现。

把所有 DSH 事件抽象成 Notification Provider、Topic、Subscription 或 Gateway 会在只有一个已证实
消费者时制造平台。把审阅状态写入 Prompt、Tool 或 Session 又会破坏普通会话的 KV Cache 前缀，
并把本应旁路的人工等待重新带回模型循环。

## 决策

新增默认禁用、可删除的 `dsh-evolve-telegram` Bridge。插件只连接同一进程中两个既有的具体服务：

- `evoforge.evolutionControl`：读取权威、浏览器安全的 Evolve overview；
- `evoforge.telegramRoute`：把一个 exact id 的有界 host notice 交给既有 Telegram delivery journal。

`dsh-telegram` 只公开这个**具体固定 Telegram route** 的耐久投递方法，不建立 channel/provider 注册表。
`dsh-evolve` 在既有 Shadow Supervisor 每轮已经完成扫描与自动策略后发出一个 host-only
`evoforge/evolution/settled` 信号；Bridge 启动时也立即扫描一次。信号不携带审阅内容，不是权威状态，
丢失时由启动扫描或下一轮既有 supervisor scan 补偿。Bridge 不创建 timer、watcher、daemon、Job 或
第二个队列。

Bridge 从 overview 只投影当前需要人类动作的阶段：

- Candidate `pending`；
- 自动批准但仍未激活的 inactive Candidate；
- Evaluator Draft `uncertain | draft-ready | incomplete`。

`qualification-running` 仍可在 Web 中显示，但它没有可立即执行的人类动作，因此不发 attention。
每条 notice id 是 `kind + exact item id + actionable stage` 的 SHA-256。相同状态的启动扫描、周期扫描、
热重载和进程重启都会命中同一 delivery record；Evaluator 从 `draft-ready` 进入 `incomplete` 是新的
决策阶段，可以发送一条新的 notice。不做定时催办。

消息只包含类型、Skill、有限状态、exact id、可复制的既有 `/evolve` 查看命令，以及“消息不是批准、
原会话继续”的说明。它不包含 Prompt、feedback 正文、绝对路径、diff、secret 或生成文件。

## 权限与失败语义

安装并启用 Bridge 是把上述有界元数据发送到 `dsh-telegram` 已授权固定私聊的明确部署策略。普通
Telegram 文本不是批准；approve/reject/promote 仍由既有 `/evolve` Command 与 Control Plane 按
exact id 执行。首版不增加 inline approve/reject 按钮，也不改变 Promotion 分离规则。

投递继续使用 `dsh-telegram` 的保守状态机：`prepared` 先持久化，明确 `429` 才有界重试，transport
中断、无效响应或 `sending` 崩溃变成 `uncertain`，不盲目重发。Telegram 不提供调用方幂等键，因此
本插件只声明耐久去重和 at-most-once retry policy，不声明 exactly-once。

缺少任一 concrete service 时 Bridge 不运行并由 DSH 依赖注入明确报错。禁用 Bridge 只停止未来
attention；原生 Session/Goal、Evolve 审阅与 Telegram 普通消息仍然可用，已经发送的消息不能回滚。

## KV Cache 契约

Bridge 和 route service 都不注册 Tool、Skill、Prompt section，不追加 Session event，也不触发模型
turn。overview 扫描、notice 文本、投递状态与 Telegram message id 全在 host plane。启用前后普通
Session 的完整 model composition 必须 byte-equivalent；空闲和每次 attention 的模型 token 增量均为
`0`。

## 非目标

- Notification Core、Provider SPI、规则 DSL、统一 Inbox 或多渠道 Gateway；
- Slack、Email、Discord、系统通知、Calendar 或 People DB；
- 第二个 timer/daemon、通用 event-sourcing/outbox 平台或 Mission；
- 每轮进度、心跳、成功 Candidate 或低价值日志通知；
- 模型生成摘要、自动批准模糊进化或首版 Telegram 审批按钮。
