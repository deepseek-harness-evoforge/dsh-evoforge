# P3.1 Evolve Telegram Attention

## 用户结果

当后台自进化第一次产生一个需要人类决定的 Candidate 或 Evaluator Draft 阶段时，既有固定 Telegram
私聊收到一条耐久、可去重的 attention。用户在同一私聊里执行既有 `/evolve` Command 查看和处理；
产生结果的原 Session 不等待，也不会增加一次模型调用。

## 最小控制流

```text
existing Shadow Supervisor settled signal ─┐
Bridge load catch-up scan ─────────────────┼─> dsh-evolve overview (authority)
                                           └─> deterministic bounded notices
                                               └─> existing Telegram journal/API

human Telegram message: /evolve ... ─────────> existing Commands/Control Plane
```

`evoforge/evolution/settled` 只是复用既有 supervisor 周期的唤醒信号，不携带状态。Bridge 每次都重读
`evoforge.evolutionControl.overview()`，所以不会把事件、Telegram 或自己的内存当作审阅权威。启动扫描
覆盖进程退出期间已经形成的 actionable item；相同 exact notice id 由 Telegram journal 去重。

## Notice 合同

```ts
interface TelegramHostNotice {
  id: string // sha256(kind + exact item id + actionable stage)
  text: string // 1..4096 chars, further bounded by route config
}

interface TelegramHostRoute {
  notify(notice: TelegramHostNotice): Promise<{
    created: boolean
    status: 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed'
  }>
}
```

该 service 是具体 `dsh-telegram` route，不是可替换 Provider。Bridge 没有配置：加载该默认禁用插件行
本身就是 opt-in；chat/user/Workspace/Session/Agent 只在 Channel Router route 中出现，token env 与
routeId 只在 `dsh-telegram` 配置中出现。

Notice 投影：

| 来源 | 阶段 | notice key stage | 查看命令 |
|---|---|---|---|
| Candidate | `pending` | `review` | `/evolve review <id>` |
| Candidate | auto-approved、未激活 | `promotion` | `/evolve review <id>` |
| Evaluator Draft | `draft-ready` | `draft-ready` | `/evolve evaluator <id>` |
| Evaluator Draft | `uncertain` | `uncertain` | `/evolve evaluator <id>` |
| Evaluator Draft | `incomplete` | `incomplete` | `/evolve evaluator <id>` |

Candidate rejected、人工 approved 且已处理、Evaluator `authoring-pending | qualification-running | qualified |
rejected` 不发送。notice 文本不得复制私有 correction、生成文件、diff、路径、Prompt 或 secret。

## 生命周期与恢复

1. Bridge 加载后串行执行一次 catch-up overview；
2. 每个既有 supervisor settled signal 只合并为下一次串行 scan，不并发扫描；
3. route 在网络调用前 durable `prepared` 与 `sending`；
4. 相同 notice id 已存在时不创建或执行第二次发送；
5. 进程从 `sending` 恢复为 `uncertain`，不自动重发；
6. dispose 停止接收新 signal，等待已开始的 host scan 收敛，然后释放监听；
7. 删除 Bridge 不删除 Evolve 证据或 Telegram 普通投递；删除 `dsh-telegram` 时沿用其既有保留披露。

## 验收门

- Candidate review、auto-approved promotion 与三种 Evaluator 人工阶段投影正确；其它状态为零 notice；
- 相同 scan、热重载、重启和重复 settled signal 只产生一个 exact delivery intent；
- `prepared`、`sending`、`uncertain` crash 语义沿用并通过现有 Telegram 故障测试；
- 假 Bot API 的 assembled DSH 路径能收到 notice，再用同一私聊的 `/evolve` Command 读取权威状态；
- notice 只走 exact configured private route，不接受模型或 Telegram 输入指定目标；
- packaged tarball add/boot/remove 后无额外 service、listener、poller 或资源残留；
- 启用前后 assembled Session composition 完全相同，新增模型请求与 token 为 `0`。

## 明确停止线

首版不加按钮、催办、优先级、模板系统、订阅或日程。飞书作为 v0.1 第二渠道只复用 Channel Router
入口，不自动把 Evolution notice 扩成公共 notification SPI；先测 discovered rate、time-to-first-review、
stale review count 与真实 Bot 多日投递，再决定是否需要跨 Adapter 的注意力投影。
