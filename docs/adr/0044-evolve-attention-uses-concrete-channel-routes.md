# ADR-0044：Evolution Attention 只组合具体渠道路由

## 背景

`dsh-evolve` 已把需要人类决定的 Candidate 与 Evaluator Draft 放入旁路审阅，Commands/Web 能读取并
执行权威动作。Telegram 首个注意力桥证明了“不阻塞原 Session、只发送有界提醒”的价值；飞书成为
第二个真实 Adapter 后，继续保留 Telegram 专用包会复制同一投影，或迫使飞书缺失进化注意力。

把所有 DSH 事件抽象成 Notification Provider、Topic、Subscription 或 Gateway 仍然会过早制造平台。
把审阅状态写入 Prompt、Tool 或 Session 则会破坏普通会话的 KV Cache 前缀。

本 ADR 取代原 Telegram-only ADR 的渠道范围，但保留其保守投递与零模型表面决策。

## 决策

将未发布的 `dsh-evolve-telegram` 更名为默认禁用、可删除的 `dsh-evolve-attention` Bundle。它硬依赖
`evoforge.evolutionControl`，并通过 Cordis 可选注入只组合两个现有的具体 route service：

- `evoforge.telegramRoute`：一个静态 Telegram route 及其 exact Workspace；
- `evoforge.feishuRoute`：一个 Feishu Adapter 实例配置的只读 `routeId → Workspace` 列表。

Telegram 与飞书是 optional peers；部署者可以只安装其一。Bridge 不提供公共 provider SPI、动态目标
注册、规则 DSL 或用户可变 destination。新增第三个平台必须先实现自己的真实 Adapter 与 route
service，再单独评审是否值得扩展这个具体组合。

每个 route 的 Workspace id 都来自 `dsh-channel-router` 的静态配置。Bridge 把该 id 显式传给 Evolve
overview，并验证返回对象属于同一 Workspace；缺失或不匹配时 fail closed。多个 Feishu route 指向
同一 Workspace 时只读取一次 overview，但仍分别进入各 route 的持久投递 journal。Bridge 不使用
recent Workspace，也不扫描全局 Evolution 状态。

Bridge 在具体 route service 出现时补扫一次，并在既有 `evoforge/evolution/settled` host-only 信号后
重读权威 overview。它不创建 timer、watcher、daemon、Job 或第二个队列。Cordis child fiber 分别拥有
Telegram/飞书桥；任一 Adapter disable/reload/remove 只释放对应桥。

只投影当前需要人类动作的阶段：

- Candidate `pending`；
- 自动批准但仍未激活的 inactive Candidate；
- Evaluator Draft `uncertain | draft-ready | incomplete`。

每条 notice id 是 `kind + exact item id + actionable stage` 的 SHA-256。Adapter 的 delivery key 同时包含
具体 route，所以同一对象可以安全投递到两个静态收件路由，重复扫描和重启则命中原记录。消息只含
类型、安全 Skill 标签、有限状态、exact id、既有 `/evolve` 查看命令，以及“消息不是批准、原会话
继续”的说明；不含 Prompt、feedback 正文、路径、diff、secret 或生成文件。

## 权限与失败语义

启用 Bundle 是把上述有界元数据发送到已由 Telegram/飞书 Adapter 静态授权 route 的明确部署策略。
普通渠道文本不是批准；approve/reject/promote 仍由 `/evolve` 与 Control Plane 按 exact id 执行。

投递完全复用各 Adapter 的保守状态机：意图先持久化，明确 `429` 才有界重试，transport 中断或
`sending` 崩溃变成 `uncertain`，不盲目重发。本 Bundle 不声明 exactly-once。

禁用 Bundle 只停止未来 attention；原生 Session/Goal、Evolve 审阅与渠道普通消息仍可用，已经发送
的消息不能回滚。

## KV Cache 契约

Bundle 与 route services 都不注册 Tool、Skill、Prompt section 或 Command，不追加 Session event，也不
触发模型 turn。overview、notice 与投递状态全部在 host plane。启用前后普通 Session 的完整模型请求
必须 byte-equivalent；空闲和每次 attention 的模型 token 增量均为 `0`。

## 非目标

- Notification Core、Provider SPI、统一 Inbox、多渠道 Gateway 或任意收件人路由；
- Slack、Email、Discord、Calendar 或 People DB；
- 第二个 timer/daemon、通用 outbox 平台或 Mission；
- 模型生成摘要、自动批准模糊进化或渠道内 inline protected action。
