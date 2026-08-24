# Hermes 当前 Gateway 与陌生发送者配对机制源码审计

> 审计时间：2026-08-25（Asia/Shanghai）  
> 官方仓库：[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)  
> 当前 `main`：[`057dcdf236f8a6a26721c10fcc6ccb72726e272a`](https://github.com/NousResearch/hermes-agent/commit/057dcdf236f8a6a26721c10fcc6ccb72726e272a)，提交时间 2026-08-24  
> 审计时最新 release tag：[`v2026.8.19`](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.19)，解引用 commit `fcbd1076a93841fa88855acce810e342a5b78101`  
> 证据范围：只使用上述 revision 的官方源码、官方仓库文档、官方 tag；没有用博客、媒体文章或二手解读。本文把“源码事实”和“对 dsh-evoforge 的设计推论”分开。

## 1. 结论先行

Hermes 当前真实流程是：

```text
常驻 Hermes Gateway 已启动并连接渠道
  -> 陌生用户向机器人发送任意私聊消息
  -> Gateway 在 Agent/Session 之前做鉴权
  -> 未授权且策略为 pair：机器人原路回复一次性配对码
  -> 管理员在主机 CLI 或认证 Dashboard 批准
  -> 授权立即持久化；无需重启 Gateway
  -> 用户下一条消息才进入确定性的 Session 路由和 Agent
```

关键纠偏如下：

1. **Gateway 是常驻入口，不是临时两分钟 listener。** 官方把它定义为连接所有已配置平台、承载 Session、Cron 和投递的单一后台进程。[官方 Messaging Gateway](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/index.md#L7-L10)
2. **首条陌生 DM 自动触发发码，不要求用户先到 Hermes/DSH 发命令。** 消息正文是什么并不重要；它在鉴权失败路径被消费，不进入 Agent。[`GatewayRunner` 未授权 DM 路径](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L16833-L16901)
3. **管理员不在聊天 Session 内 claim。** 管理员使用 `hermes pairing approve <platform> <request-id|code>`，或在认证 Dashboard 的 Pairing 页批准 pending request。[CLI 实现](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/pairing.py#L13-L102) [Dashboard API](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/web_server.py#L13838-L13912) [Dashboard 页面](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/web/src/pages/PairingPage.tsx#L30-L69)
4. **配对授予的是平台 principal 访问权，不是把某个渠道绑定到“当前聊天 Session”。** 授权成功后，下一条消息再按平台、chat、thread、profile 等生成 Session key。[授权表与 allowlist 的并集](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/authz_mixin.py#L590-L607) [`build_session_key`](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/session.py#L1090-L1212)
5. **Hermes 官方文档存在明显漂移。** `gateway-internals.md` 仍写“管理员 `/pair` 先发码、新用户回码”，但当前命令表和源码没有 `/pair`；FAQ 还写“首个 DM 用户直接 claim”，也与必须由管理员批准的源码不符。当前实现应以 `gateway/run.py`、`gateway/pairing.py`、CLI/Dashboard API 为准。[过期流程文档](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/developer-guide/gateway-internals.md#L92-L111) [冲突 FAQ](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/reference/faq.md#L417-L429)

## 2. Gateway 是否常驻，以及入口是什么

### 2.1 源码事实

- `hermes gateway run` 是前台常驻入口；裸 `hermes gateway` 也可运行。`gateway install/start/stop/status` 用于 systemd/launchd 后台服务；Docker 中可交给 s6 监督。[CLI parser](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/subcommands/gateway.py#L32-L103) [官方服务命令](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/index.md#L142-L163)
- `GatewayRunner.start()` 在启动期创建已启用 Adapter，安装 message/fatal-error/session/auth 回调，并发执行各 Adapter 的 `connect()`。[启动入口](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L12483-L12489) [Adapter 装配与并发连接](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L12921-L12980)
- 即使没有平台连接成功，只要是可重试故障，Gateway 仍会保持运行，以便 Cron 执行和后台重连；没有启用消息平台时也继续运行 Cron。[降级常驻](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L13172-L13240)
- 进入运行态后设置 `_running = True`，启动后台 watcher；主进程最终阻塞在 `wait_for_shutdown()`，直到 shutdown event。[运行边界](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L13242-L13263) [常驻等待](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L15361-L15363)
- Adapter 重连由 Gateway 的 supervised watcher 统一兜底：30、60、120、240、300 秒指数退避，retryable failure 在 300 秒上限持续重试；non-retryable failure 退出重试队列。[重连 watcher](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L14415-L14469)
- 外层还有 systemd/launchd/s6/Docker restart policy。Hermes 把“进程保活”和“Adapter 连接自愈”分成两层，不用一次短窗口代替常驻服务。[Linux/macOS 服务](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/guides/team-telegram-assistant.md#L120-L167) [Docker 常驻方式](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/docker.md#L85-L100)

### 2.2 对 dsh-evoforge 的设计推论

- `dsh-gateway` 应随 DSH Host/Bundle 生命周期常驻；`dsh-feishu` 安装且启用后应立即连接官方 Feishu WebSocket，直到 Cordis dispose，而不是只有用户点“开始配对”才连接。
- 配对是常驻 Gateway 的**鉴权子模块**，不是 Feishu 临时 setup 模式，更不是 DSH Agent Session 中的 Command。
- DSH 的进程生命周期仍由 DSH Host、Cordis effect/dispose 和操作系统服务负责；插件不得再造第二 daemon/runtime。所谓“Gateway 常驻”应是 **DSH Host 内常驻的 Gateway service + Adapter connection**。
- DSH Web 应读取 Gateway 权威状态：`starting/connected/degraded/retrying/needs-attention/disposed`，而不是通过“能不能临时生成短语”推断是否在线。

## 3. 首条消息如何触发配对码

### 3.1 源码事实

1. Adapter 先把平台原始事件规范化为 `MessageEvent`/`SessionSource`，交给 `GatewayRunner._handle_message()`。[统一 `MessageEvent`](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/platforms/base.py#L2299-L2338)
2. Gateway 在 Session/Agent dispatch 之前调用 `_is_user_authorized()`。授权来源包括平台 allow-all、角色、paired principal、平台/全局 allowlist；默认拒绝。[鉴权入口与 paired grant](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/authz_mixin.py#L385-L406) [paired principal 检查](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/authz_mixin.py#L574-L607)
3. 未授权消息只有在 `chat_type == "dm"` 且 effective `unauthorized_dm_behavior == "pair"` 时发码；群聊、forum、channel 不发码，直接忽略。[未授权 DM 分支](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L16833-L16901)
4. 该分支不检查消息正文是否等于某个短语。因此“你好”“1”或任意普通文本都能触发。首条文本不会进入 Agent，也不会在批准后自动重放；CLI 成功提示明确说明用户在**下一条消息**才会被识别。[CLI 成功提示](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/pairing.py#L61-L83)
5. 机器人原路回复 8 位 code，并直接告诉用户请 owner 运行 `hermes pairing approve <platform> <code>`。[发码回复](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L16864-L16890)

### 3.2 一个容易忽略的当前策略

“陌生 DM 一定发码”不是无条件事实。当前策略解析是：

- 平台显式 `unauthorized_dm_behavior` 最高优先；
- Email 默认静默，除非显式 opt in；
- Adapter `dm_policy: pairing` 发码，`allowlist/disabled` 静默；
- 已配置任一平台或全局 allowlist 时，默认静默，避免向陌生联系人泄漏机器人存在；
- 没有 allowlist、没有覆盖时，chat-shaped platform 默认 `pair`。

见 [`_get_unauthorized_dm_behavior`](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/authz_mixin.py#L794-L897)。因此官方 Team Telegram 文档中“未列入 allowlist 的 teammate 会自动拿码”只有在显式启用 pairing，或没有 allowlist 的配置下才成立；文档没有讲清这一前提。[Team Telegram 流程](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/guides/team-telegram-assistant.md#L190-L250)

### 3.3 对 dsh-evoforge 的设计推论

- 飞书 App ID/Secret 解决的是 **Adapter 凭据与传输连接**；陌生发送者 pairing code 解决的是 **外部 principal 授权**。两者必须分开建模。
- 当前用户已经提供 App ID/Secret 后，正确状态应是：`dsh-feishu` WebSocket 常驻监听；用户随便发一条私聊，机器人立即回码。不能再要求用户先在 DSH 内生成短语。
- 首条消息必须明确标记 `consumed_for_pairing`，不能偷偷送 Agent。批准后是要求用户再发一条，还是受控地重放首条，必须作为显式产品决策；Hermes 当前选择“不重放”，更安全但多一步。
- 群聊不应靠普通发码完成 owner 身份发现。首版可以只允许 DM pairing；群聊 route 由已授权 owner 在 DSH Web 中确认 exact chat/tenant/Workspace，避免任意群成员抢占。

## 4. 管理员如何批准并完成绑定

### 4.1 源码事实

Hermes 提供两个管理入口，二者都绕过 Agent Session：

- **主机 CLI**：`hermes pairing list|approve|revoke|clear-pending`。`approve` 接收 `(platform, request-id|code)`；`list` 显示 pending 的 platform、server-side request ID、user ID/name/age。[parser](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/subcommands/pairing.py#L14-L40) [CLI 行为](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/pairing.py#L26-L83)
- **认证 Dashboard**：`GET /api/pairing` 读取 pending/approved；`POST /api/pairing/approve` 用 request ID 或 code 批准；Pairing 页面直接对 pending row 点 Approve，也可以 revoke/clear。[服务端 API](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/web_server.py#L13838-L13933) [前端 Approve](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/web/src/pages/PairingPage.tsx#L156-L214)

Dashboard 不需要管理员把用户收到的 code 再输入网页。它列出 pending request 的 `request_id`，code 只发给外部用户且在本地仅保存 hash；认证管理面按 request ID 批准，避免把 code 暴露到管理列表。[`approve_request`](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L753-L798)

批准完成的是 `{platform, normalized_user_id}` principal grant。Gateway 每次鉴权都从文件读 approved store，所以另一个 CLI/Dashboard 进程写入后，下一条消息立即生效，无需 restart。[`is_approved`](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L544-L562) [官方“立即生效”说明](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/guides/team-telegram-assistant.md#L228-L250)

### 4.2 对 dsh-evoforge 的设计推论

- DSH 对应入口应是 `dsh-gateway` 的 Host-side pairing control + `dsh-gateway`/`dsh-feishu` 同包 DSH Web 控制面；**不应通过当前 DSH Session 的 `/feishu-pair` Command 批准**。
- DSH Web 应直接展示 pending principal：平台、App/account、tenant、chat/user 的脱敏标识、display name、first-seen/expiry、风险提示，以及 Approve/Reject。用户也可以把机器人返回的 code 给管理员，管理员在管理面输入 code；两条路径都不需要选择 Agent/Skill/工作流。
- 批准不应把身份绑定到“打开 Pairing 页时碰巧存在的 Session”。它应绑定到预配置的 DSH Workspace/Agent preset/route policy；授权用户下一条消息到达时，由 `dsh-gateway` 创建或恢复**原生 DSH Session**。
- 若当前部署只有一个目标 Workspace，可配置一个 setup-time default route policy，配对批准时物化 exact route；若有多个目标，管理员在 DSH Web 审批 pending 时选择目标属于有意义的授权决策，但不能让外部用户在开场选择路径。

## 5. 配对状态、过期、重放与多通道行为

### 5.1 源码事实

`PairingStore` 每个平台维护：

- `{platform}-pending.json`：pending request；
- `{platform}-approved.json`：已批准 principal；
- `_rate_limits.json`：请求频率、失败计数和 lockout。

默认新布局是 `${HERMES_HOME}/platforms/pairing/`；已有非空旧安装可继续使用 `${HERMES_HOME}/pairing/`，初始化时还会合并 split directory。Profile 使用自己的 Hermes home，因此 pairing grant 彼此隔离。[目录解析](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_constants.py#L276-L311) [`PairingStore` profile scope](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L435-L480)

安全与生命周期：

- code 为 8 位、来自排除 `0/O/1/I` 的 32 字符表，使用 `secrets.choice()`；TTL 1 小时；同一 user 10 分钟只能申请一次；每个平台最多 3 个 pending；连续 5 次错误 code approval 后该平台锁 1 小时。[常量](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L46-L57) [生成逻辑](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L639-L693) [lockout](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L844-L897)
- pending 不保存明文 code，只保存 16-byte salt + SHA-256 hash、随机 16-hex `request_id`、user id/name 和 `created_at`；code 比较使用 `secrets.compare_digest()`。[hash 与 pending schema](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L608-L688) [验证](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L695-L751)
- 成功 approval 先删除 pending，再写 approved；同一个 code/request ID 再用会失败，构成一次性语义。[完成 approval](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L615-L637)
- 过期清理是调用 `generate/approve/list` 时的 lazy cleanup；`clear_pending` 实际清除全部 pending，不只是过期项。[清理逻辑](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L800-L842) [TTL cleanup](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L901-L925)
- JSON 写入采用 temp file、flush、`fsync`、atomic replace，POSIX 下 chmod `0600`。[安全写入](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L409-L432)
- grant 以 platform 分文件，因此 Telegram 用户与 Feishu 用户即使代表同一自然人，也要分别批准。WhatsApp/WhatsApp Cloud 额外做 phone/JID alias normalization；其余平台主要使用 Adapter 提供的 user ID。[平台映射与 WhatsApp identity](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L92-L118) [identity alias](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L146-L176)
- 若平台已有显式 allowlist，approval 会 best-effort 把 principal 同步进 allowlist；无 allowlist 时 pairing store 自身就是 grant source。revoke 会同步移除并尝试清掉 live Adapter 的旧 allowlist snapshot。[allowlist 同步](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L205-L231) [revoke 同步](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L291-L357)

### 5.2 源码可见的可靠性缺口

以下是基于上述源码的推论，不是 Hermes 官方声明：

1. `threading.RLock` 只保护一个进程内的 read-modify-write；Gateway、CLI、Dashboard 若是不同进程并发改同一 JSON，没有跨进程事务锁。atomic replace 防止半文件，但不能防止两个 writer 的 lost update。
2. `_finish_approval()` 先写 pending 删除，再写 approved grant。这两个文件之间没有事务；若进程恰在中间崩溃，pending 已消失而 grant 尚未建立，用户需要重新发码。
3. TTL cleanup 是 lazy，不是 durable scheduler。过期 row 可能继续留盘，直到下一次相应操作；鉴权安全不受影响，因为 approval 前会 cleanup，但状态卫生依赖后续访问。
4. 同一用户在 10 分钟内再次 DM 不会重发原 code，而是静默；如果第一次回复丢失，用户无法立刻恢复。10 分钟后又可能创建新 code，同时旧 code 尚未过期并占用 pending 名额。
5. global per-platform failed-code lockout 会让一个攻击者的猜码影响该平台所有合法审批，属于可用性换安全性的粗粒度策略。

### 5.3 对 dsh-evoforge 的设计推论

- 不应照搬多 JSON 文件事务。配对状态应落在 DSH Gateway 自己的单一 durable Storage Domain/事务记录中，原子完成 `pending -> approved/rejected/expired`，并带 compare-and-set version。
- 必须有唯一 `PairingRequestId`、只保存 code hash、一次性 consume、TTL、per-principal rate limit、per-account pending cap、审计主体与时间；code approval 和 Web request-id approval 要用不同威胁模型。
- 同一 endpoint 重复 DM 时应幂等返回同一个尚有效 code，或明确回复“已有待审批请求”，不能沉默十分钟；不得生成无界 pending。
- grant 的 key 至少应包含 `adapter kind + app/account/tenant + normalized principal`，不能只用 `platform + user_id`，否则多个飞书 App/tenant 共用 Gateway 时可能串权。
- 批准、拒绝、过期、撤销、重启恢复和 replay 必须在 DSH Web 可见；撤销后下一条消息立即拒绝，不依赖 reload。

## 6. Adapter 与 Gateway 核心边界

### 6.1 源码事实

Hermes 的意图边界是：

| 层 | 主要责任 |
|---|---|
| Platform Adapter | 平台 SDK/凭据、连接与断开、接收原始事件、规范化 `MessageEvent`、平台发送、媒体与 thread/reaction 等平台特性 |
| Gateway core | Adapter 生命周期装配、统一 authorization/pairing、Session key、Agent dispatch、busy/interrupt、Cron/home-channel delivery、运行状态与重连兜底 |
| PairingStore | 跨 Adapter 共用的 pending/approved/rate-limit 持久状态；不处理模型、Agent 或消息正文 |

`BasePlatformAdapter` 的最小抽象要求 `connect(is_reconnect) / disconnect() / send()`，并由 Gateway 注入统一 message handler；`connect()` 文档还要求有 server-side update queue 的 Adapter 在 reconnect 时保留离线消息。[Adapter 接口](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/platforms/base.py#L2890-L2899) [handler seam](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/platforms/base.py#L3631-L3655) [生命周期接口](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/platforms/base.py#L3958-L4003)

具体 Adapter：

- **Telegram**：`python-telegram-bot`；默认 long polling，也支持带 secret 的 webhook。重连时 server update queue 可保留离线消息。[官方 Telegram 文档](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/telegram.md#L247-L274)
- **Discord**：真正的 Discord Gateway WebSocket，不是 stateless webhook。Adapter 做 WS health；连续异常发 retryable fatal，由 Gateway reconnect watcher 重建 Adapter，避免第二个无界重连循环。[官方 Discord 文档](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/discord.md#L30-L40) [Discord 重连边界](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/discord.md#L85-L99)
- **Slack**：Bolt SDK Socket Mode，经 WebSocket 常驻，不需要公网 URL。[官方 Slack 文档](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/slack.md#L7-L24)
- **WhatsApp**：默认是 Baileys Node bridge，模拟 WhatsApp Web；`hermes whatsapp` 的 QR pairing 是**传输账户登录**，与陌生用户 DM authorization pairing code 是两件事。Bridge session 另存 `${HERMES_HOME}/platforms/whatsapp/session`，Gateway 启动时复用。[官方 WhatsApp 文档](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/whatsapp.md#L7-L16) [Bridge session](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/whatsapp.md#L141-L166)
- **Feishu/Lark**：官方 SDK；推荐 persistent outbound WebSocket，无公网 URL，SDK 管 heartbeat/自动重连；也可选 webhook HTTP server。消息仍走统一 Gateway 鉴权和 Session 流。[官方 Feishu 文档](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/feishu.md#L7-L14) [Feishu WebSocket 生命周期](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/feishu.md#L94-L104)

### 6.2 边界并不完全干净

Hermes 虽然有 Platform Registry，但 pairing/authz core 仍硬编码大量 `{platform -> ALLOWED_USERS/ALLOW_ALL}` map，并在 pairing core 中直接知道 WhatsApp alias。这说明它的 Adapter 抽象还不够深。[Platform Registry 意图](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/platform_registry.py#L1-L29) [pairing 的硬编码 map](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/pairing.py#L92-L139) [authz 的硬编码 map](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/authz_mixin.py#L512-L570)

### 6.3 对 dsh-evoforge 的设计推论

- `dsh-gateway` 应拥有平台无关的 `Principal`, `PairingRequest`, `Grant`, `ExactRoute`, `IngressReceipt`, `OutboundIntent`, `TransportObservation`；Adapter 只声明 identity normalization、account/tenant scope、DM/group kind、send/connect/dispose 和平台 capability。
- `dsh-feishu` 应拥有官方 Lark SDK、App credential 解析、WebSocket、飞书 chat/user/tenant 标识、卡片/文件/资源权限；它不应拥有 DSH Session/Goal/Agent，不应另造私有 approval/runtime。
- Gateway 不能硬编码 Feishu/Telegram env 名和 user-id alias。Adapter registration 应把 `credential scope + principal normalization + authorization capabilities` 作为显式契约注入。
- Adapter 自己的 SDK 自动重连与 Gateway 的 Adapter 重建不能形成两个争抢连接的无界 loop；必须明确一种主责任和 fatal escalation seam。

## 7. Session routing、启动恢复与持久化

### 7.1 源码事实

- PairingStore 在 `GatewayRunner` 构造时就创建；多 profile 有各自 PairingStore。它不是某个 Session 临时创建的对象。[Gateway pairing store](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L7225-L7233)
- 鉴权通过后才调用统一 Session 路由。DM 通常按 `profile/platform/dm/chat_id[/thread]` 隔离；普通 group 默认按 participant 隔离；thread 默认多人共享；Slack 还加 workspace scope。实现明确要求所有调用者使用 `build_session_key()`，不能各 Adapter 手拼。[Session key 规则](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/session.py#L1054-L1128) [构造实现](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/session.py#L1129-L1212)
- `SessionStore` 的主要事实源是 SQLite `state.db` 中的 gateway routing/session transcript，失败时兼容 JSONL/`sessions.json` fallback；它和 pairing store 是不同状态域。[SessionStore](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/session.py#L1245-L1277) [routing load](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/session.py#L1454-L1533)
- Gateway 对进程崩溃后的 in-flight turn 有 `resume_pending`、active-turn marker、startup restore；平台重连成功后还会重新调度该平台的 pending resume。[重连后恢复](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/run.py#L14525-L14592) [Session 恢复字段](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/session.py#L876-L928)
- 最终回复另有 durable delivery ledger，语义明确为 at-least-once；mid-send crash 的重投会提示可能重复，而不是宣称 exactly-once。[官方 delivery reliability](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/website/docs/user-guide/messaging/index.md#L233-L252)

### 7.2 对 dsh-evoforge 的设计推论

- DSH 必须继续以原生 Workspace/Session/Agent/Goal 为权威；Gateway 只维护外部 endpoint 到原生对象的 route 和 durable ingress/outbound，不创建 Hermes 式第二 SessionStore。
- pairing grant、route、native Session 是三件不同的事：`grant` 回答谁能进；`route` 回答进哪个 Workspace/Agent policy；`DSH Session` 承载真实对话。三者不能揉成“当前 Session claim code”。
- approval 后无需修改 `cordis.patch.yml`、reload Bundle 或重启 Host。配置只负责 Adapter credential/default route policy；具体 principal grant/route 是 Gateway 的 durable runtime state，并受 Web 管理、撤销和审计。
- route 创建必须 exact、幂等、可恢复。下一条消息以 `app/account/tenant/chat/thread/principal` 解析 route；未批准 principal 永远不创建 Session、不调用模型。

## 8. 哪些值得借鉴，哪些不能照搬

### 8.1 值得借鉴

- Gateway 从启动到 dispose 全程常驻，配对只是鉴权状态，不是连接窗口。
- 陌生 DM 的首条任意消息自动触发一次性 code，且在 Agent 之前消费。
- 管理员通过独立可信管理面批准；Dashboard 用 server-side request ID，不展示 code。
- approved principal 与 allowlist 构成明确授权并集；revoke 下一条消息即时生效。
- code 不落明文、constant-time compare、TTL/rate-limit/pending cap/lockout、profile scope。
- Adapter 规范化入站，Gateway 集中做授权、Session 路由、Agent dispatch 与重连治理。
- 对掉线和进程崩溃区分：Adapter reconnect、process supervisor、Session restore、delivery ledger 各自负责不同故障面。

### 8.2 不能照搬

- 不能复制 Hermes 大型一体化 `GatewayRunner` 和第二套 Agent/Session/Cron runtime；DSH 已有原生服务与事实源。
- 不能复制聊天 Session 内 approval；Hermes 当前也不是这么做，DSH 应用原生 Web/control authority。
- 不能复制多 JSON、进程内锁和跨文件非事务 approval；DSH 应有原子 durable transition。
- 不能复制按 `platform + user_id` 的过窄 grant key；飞书至少还要绑定 App/account/tenant。
- 不能复制核心硬编码平台 env/identity map；这些应由 Adapter contract 提供。
- 不能复制“重复 DM 十分钟静默”的恢复体验，也不能让一次丢失回复迫使用户等待。
- 不能把 WhatsApp QR/Telegram bot onboarding 这种**传输凭据配对**，和陌生用户的**访问授权配对**混为一个状态机。
- 不能照搬官方过期文档中的 `/pair` 反向流程，也不能照搬 FAQ 所称“首个 DM 自动 claim”；二者均不符合当前源码。
- 不能宣称 exactly-once 外部效果。发送中崩溃必须保守标记 `uncertain`，提供可见恢复和重复风险。

## 9. 对当前 dsh-evoforge 偏差的明确修正

当前“DSH Web/Session 先生成一次性短语 -> 用户把短语发给飞书 -> 插件临时监听并发现 route”的方案与 Hermes 当前实现和用户目标都相反，应删除而不是继续兼容。目标流程应改成：

```text
DSH Host boot
  -> dsh-gateway 常驻
  -> dsh-feishu 使用既有 App ID/Secret 建立并维持官方 WS
  -> 任意陌生 DM 到达
  -> Adapter 规范化 account/tenant/chat/principal
  -> Gateway auth 拒绝 Agent dispatch，原路返回 PairCode
  -> DSH Web 出现 Pending Pairing（不调用模型）
  -> 管理员 Approve/Reject，或输入用户转交的 code
  -> 原子建立 Grant + exact route（不改 patch、不 reload、不重启）
  -> 用户下一条消息进入既定 Workspace，并创建/恢复原生 DSH Session
  -> 最终回答经 Gateway durable outbound 交回飞书
```

首个可验收纵切至少应证明：

1. clean profile 安装 `dsh-gateway` + `dsh-feishu` 后，DSH boot 即建立 Feishu WebSocket；
2. 无 DSH 页面预操作、无 Session Command，陌生用户普通 DM 在真实飞书收到 code；
3. 首条消息不创建 Session、不调用模型；
4. DSH Web 实时显示同一 pending principal，并可 Approve/Reject；
5. approval 原子持久化，Host 不重启即生效；code/request ID 重放失败；
6. 用户下一条消息进入 exact route 的原生 Workspace/Session/Agent，并收到真实回复；
7. 断网重连、Host crash/restart 后 pending/grant/route 保留且不会重复创建；
8. revoke 后立即阻断后续消息；多 App/tenant/user 不串权；
9. reload/dispose/uninstall 释放 WS、timer、HTTP client 和 Gateway registration；卸载插件不删除原生 DSH Session/Goal；
10. DSH Web 展示 transport、pending、approved、route、retry、last error、revoke/recovery，且所有健康读取 0 模型调用。

这才是“网关常驻 + 首条消息自动发码 + 管理面批准 + 原生 Session 路由”的正确框架。
