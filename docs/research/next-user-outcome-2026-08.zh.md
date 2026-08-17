# EvoForge 下一个最小用户结果：一手证据与候选排序

> 调研快照：2026-08-17
> 代码基线：EvoForge `750b75fd62e65e6e302bebff1d63b3637b6ce1ef`；DSH `47f943859bef60e4160492346772ded9b24f765a`
> 本文是需求排序，不是实现完成声明。
> 后续实现将未发布的 Telegram 专用候选收窄并更名为 `dsh-evolve-attention`；它仍只适配 Suite 内已有的 Telegram/Feishu 具体 route，不是通用通知平台。

## 结论

下一项只做 **`dsh-evolve-attention`**（调研时暂名 `dsh-evolve-telegram`）：

> 当后台自进化产生新的待审 Candidate 或 Evaluator Draft 时，部署授权的现有 Telegram 私聊收到一条确定性、可去重的 attention 消息；用户在同一私聊里复用现有 `/evolve` Command 查看、拒绝或批准，原 Session 不等待。

它解决的是现有闭环里最后一段真实断点：EvoForge 已经能把模糊改进放入旁路审阅，也已经有 Web/Commands 和 Telegram 单私聊，但用户仍需主动轮询才知道“现在有事要处理”。[当前 `dsh-evolve` README](../../packages/dsh-evolve/README.md)列出了审阅命令；[P1.17 契约](../architecture/p1-17-human-approved-qualify-and-shadow.zh.md)明确 Web 不轮询；[当前 `dsh-telegram` README](../../packages/dsh-telegram/README.md)只承诺完成 turn、原生 Command 与 DSH Approval，没有 Evolve attention。

这不是“通知平台”，也不是新的审批系统。首版只连接两个已经存在的插件和一个固定私聊，不新增 daemon、timer、channel abstraction、模型 Tool、Prompt、Skill 或动态 Session 前缀。

## 研究方法与证据边界

- 只使用所有者控制的一手资料：官方文档、官方源码、官方 Issue/Discussion 与第一方 API 文档。
- 先读取仓库已有的[用户痛点证据](user-pain-evidence.md)、[公开自进化审计](public-self-evolving-agents.zh.md)和[Hermes 上位验收记分卡](../architecture/hermes-replacement-scorecard.zh.md)，本文只研究“已交付能力之后的下一个缺口”。
- GitHub Issue/Discussion 是自选择样本，不能代表全部用户；项目文档说明产品意图，也不能证明市场频率。因此下文把“事实”和“推断”分开，并把频率写成可校准的等级，不声称“多数用户”。
- 当前没有 EvoForge 安装遥测、真实 Bot 多日数据、review-age 分布或陌生用户可用性数据；推荐仍是有证据约束的产品判断，不是已验证市场结论。

## 已确认的事实

### 1. “长任务结束或需要决定时提醒我”是成熟产品正在显式解决的用户结果

- Claude Code 官方 Hooks 指南把“Claude 需要输入时通知”列为常见模式，目的就是让用户离开终端做别的事而无需反复检查；`permission_prompt` 和 `idle_prompt` 是两种独立的确定性触发。[Claude Code Hooks 指南](https://code.claude.com/docs/en/hooks-guide) · [Hooks reference](https://code.claude.com/docs/en/hooks)
- Claude Code Remote Control 官方文档称，移动推送通常在长任务完成或需要用户决定时出现。这说明“远离开发机仍能收到 attention”已经进入一方产品能力，而不只是第三方插件设想。[Claude Code Remote Control](https://code.claude.com/docs/en/remote-control)
- Claude Code 官方仓库的功能请求 #29928 记录了用户为区分“真正完成/需要输入”和普通 Stop 事件而自行做 debounce、transcript 解析、冷却文件甚至 LLM classifier；该 Issue 不能证明市场占比，但能证明错误触发与漏触发会把一个简单提醒做成脆弱系统。[anthropics/claude-code#29928](https://github.com/anthropics/claude-code/issues/29928)
- Hermes 的官方发布记录已经包含 Telegram/Slack Approval 按钮、周期性通知、重复消息防护和 delivery 状态；其程序化接口也把 `approval.request` / `approval.respond` 作为一等事件。这证明消息侧 attention + action 有明确用户价值，也同时展示了完整 Gateway 会迅速膨胀的复杂度。[Hermes v0.8.0 release](https://github.com/NousResearch/hermes-agent/blob/main/RELEASE_v0.8.0.md) · [Hermes programmatic integration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)

**推断：** 对长期自治而言，最有价值的不是“所有事件都推送”，而是只推送会改变下一步决策的少数状态。完成通知、权限请求和 Evolve 审阅都属于 attention；普通日志、进度和后台心跳不属于。

### 2. 自进化项目普遍把人工审阅放在发布前，却没有解决审阅如何主动抵达

Hermes Self-Evolution 的官方计划把候选输出为 Git branch + PR，最后由人类 review/merge；其连续循环仍是后续 Phase 5。该设计证明“候选生成后仍需要可信人工闸门”，但没有提供 live Agent 中的非阻塞触达闭环。[Hermes Self-Evolution PLAN](https://github.com/NousResearch/hermes-agent-self-evolution/blob/main/PLAN.md)

EvoForge 已比这一点更进一步：模糊项进入旁路 inbox，review 不阻塞原会话；用户可以通过现有 Commands/Web 查看 exact diff、证据和限制，批准后也只生成 inactive Generation，Promotion 仍分离。[当前 `dsh-evolve` README](../../packages/dsh-evolve/README.md) · [P1.17 契约](../architecture/p1-17-human-approved-qualify-and-shadow.zh.md)

**推断：** 继续增加 Candidate 搜索器的边际价值低于先消除“审阅已经存在但没人知道”的运营断点。触达率、处理时延和 stale review 数也是后续判断自动晋升策略是否实用的必要数据。

### 3. DSH 已有足够接缝，不需要再造运行时或工作流

固定 DSH revision 的事件矩阵已经提供 `goal/changed`、`approval/request`、`domain/changed`、Agent/Session 生命周期；Commands 是独立的人类控制面。原生 Schedule、Jobs 和 Approval 也已经存在。[DSH 事件矩阵](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/event-producer-consumer.zh.md) · [DSH Tool catalog](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/tool-catalog.md)

当前 `dsh-telegram` 已将一个固定私聊映射到一个稳定 Agent，支持原生 Commands、一次性 DSH Approval、耐久 delivery journal 和 429 有界重试，且普通 Session 模型表面为零。[`dsh-telegram` README](../../packages/dsh-telegram/README.md)

**推断：** 下一个实现只需要一个窄 integration plugin，把 Evolve 的既有 actionable transition 投递给既有 Telegram route；若先抽象 `NotificationProvider`、Outbox 平台或多渠道 Gateway，就是在只有一个消费者时制造公共平台。

### 4. 消息/日程有潜在价值，但现在的证据与权限成本不支持优先

Hermes 官方仓库有 Google Workspace Skill，也有用户提出“消息 → People DB → 日程/会前准备”的功能请求；这说明个人助理闭环有真实需求样本，但仍只是一个仓库内的供给和自选择 Issue，不能推出 DSH 用户的使用频率。[Hermes Skills catalog](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/skills-catalog.md) · [NousResearch/hermes-agent#12323](https://github.com/NousResearch/hermes-agent/issues/12323)

Google 官方文档要求 Calendar 访问走 OAuth，并建议最小、渐进授权；读取 Calendar event 本身属于敏感 scope，写入则需要更高权限。公开应用还可能涉及 OAuth verification。[Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) · [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) · [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

**推断：** 日程首片即使只做“明日议程”，也要正确处理 OAuth token 生命周期、敏感信息、时区、全天/重复事件和外部 API 故障；它不是当前最小纵切。创建/修改日程还属于明确外部写入，必须单独批准，不能顺手并入读侧摘要。

### 5. 更强的 DSH 直接信号存在，但不应被伪装成新插件

DSH 早期 Discussion 对 CLI 和远程访问的互动明显；远程 Web 讨论同时明确暴露了网络 RCE 与鉴权边界。关闭终端导致进程退出也有直接提问。[DSH #67 CLI](https://github.com/deepseek-ai/deepseek-harness/discussions/67) · [DSH #76 remote access](https://github.com/deepseek-ai/deepseek-harness/discussions/76) · [DSH #74 resident process](https://github.com/deepseek-ai/deepseek-harness/discussions/74)

**推断：** 这些是更强的总体采用信号，但 CLI 已由 DSH 本身提供；进程常驻已由 `dsh-resident` 增强；绕过 loopback/RCE 安全限制属于 DSH Core/部署策略而非 EvoForge 新能力。它们不构成再造 `dsh-remote` 或修 Core bug 的授权。

## 三个候选

| 排名 | 候选 | 场景频率与证据 | 现有替代 | 最小用户结果 | 复杂度 | KV / token 影响 | 验证方式 |
|---:|---|---|---|---|---|---|---|
| 1 | **`dsh-evolve-attention`**（原候选名 `dsh-evolve-telegram`） | 对未启用自进化者为零；对启用自动 Candidate/Draft 的用户，每个模糊结果都可能触发。频率未测，但每次都对应一个必须处理或过期的高价值决定；当前仓库缺口是直接事实 | 手工打开 Web、反复运行 `/evolve status|review`、依赖记忆回来看 | 新 actionable review 出现后，静态授权的 Telegram/Feishu route 收到一次可解释提示，并复用现有 `/evolve` 控制面处理；原 Session 不等待 | 小到中：一个窄集成包、耐久去重、重启恢复；不新建决策状态 | **普通 Session 0**；确定性消息 0 模型调用；`/evolve` Command 0 模型调用；不改变当前 Session composition | fake Telegram/Feishu 边界 + assembled DSH；Candidate/Draft 两类 transition；重复/重启/uncertain delivery；exact route；stale command fail closed；composition parity；packed add/boot/remove；真实渠道 soak 后补 |
| 2 | `dsh-desktop-attention` | 长任务完成/需输入是高频通用场景，一方 Claude 文档与 Issue 证据强；但 EvoForge 已用 Telegram 覆盖 turn 完成和 DSH Approval | 终端 bell、OS 原生通知、Claude-style hook、现有 `dsh-telegram` | Goal complete/blocked 或 DSH Approval 时，本机弹出确定性通知 | 单平台小，macOS/Linux/Windows 一致实现与 E2E 为中；跨平台语义容易膨胀 | 0 Tool/Prompt/Skill；0 模型调用；只在 host event 后执行 | fake process adapter；三系统命令/转义；实际 macOS 通知冒烟；dispose 无遗留 |
| 3 | `dsh-calendar-briefing` | 可能每天发生，个人助理价值直观；目前只有 Hermes 能力/Issue 样本，没有 DSH 直接需求或 EvoForge 用户数据 | Google Calendar 自带通知/Agenda、现有客户端、Hermes Google Workspace Skill | 只读未来 24 小时事件，生成固定格式摘要并投递 Telegram；不创建/修改事件 | 中到大：OAuth、refresh、scope、时区、重复事件、敏感数据、限流 | 固定格式可做到普通 Session 0；若让 Agent 总结会新增请求 token；若加 calendar Tool 则启用该插件的 Session 多一个稳定 schema | fake Calendar API；DST/全天/重复事件；最小 scope；token revoke；429/5xx；真实 OAuth 只读验收；写入另立 Protected Action 测试 |

## 为什么唯一推荐 `dsh-evolve-attention`

### 它完成的是现有产品结果，不是新平台

当前链路是：

```text
后台反馈/Shadow
  -> Candidate 或 Evaluator Draft 成为 actionable
  -> Commands/Web 已可审阅
  -> 用户必须自己想起来查看
```

首版只补最后一跳：

```text
actionable transition
  -> 固定私聊的一条耐久 attention
  -> 用户发送既有 /evolve 命令
  -> 既有 Control Plane 按 exact id 执行
```

它直接提高三个产品指标：

1. `review discovered / actionable created`：审阅是否真的被看见；
2. `time-to-first-review`：从后台结果产生到用户第一次处理的时长；
3. `stale automatic review count`：因无人发现而过期的自动审阅数。

这三项比“又支持了一个渠道”更能证明持续进化是否在真实生活中可运营。

### 首版范围

- 只依赖同一 suite 内的 `dsh-evolve` 与 `dsh-telegram`；缺少任一依赖则加载失败并说明原因。
- 只处理两类已有 actionable 状态：Candidate review、Evaluator Draft review。
- 只在状态首次变为 actionable 时发送；不做定时催办。重启时可扫描已有状态，但必须用 exact item identity + status 做耐久去重。
- 消息只含 bounded 元数据：类型、安全截断后的 Skill 名、有限状态或建议、exact id、可复制的既有 `/evolve` 查看命令。claim、私有 feedback 正文、绝对路径、diff、Prompt、secret 均不外发。
- Telegram 消息不是用户输入，更不是批准。批准/拒绝仍通过现有 Command control plane；批准 Candidate 仍只创建 inactive Generation，Promotion 保持分离。
- 投递沿用当前 Telegram 的保守语义：发送结果不确定时标记 `uncertain`，不盲目重发并虚称 exactly-once。
- 默认关闭；管理员配置这一固定 route 才表示允许把 bounded Evolve 元数据发送到该私聊。

### 明确不做

- 不做 `dsh-notification-core`、Provider SPI、Topic/Subscription、规则 DSL 或统一 Inbox。
- 不做 Slack、Email、Discord、短信、系统通知的同批抽象；第二个真实 adapter 出现以前没有公共 channel seam。
- 不新增 timer、常驻进程、队列服务、event-sourcing/outbox 平台或 Mission。
- 不把 notification 注入 Session，不让模型撰写摘要，不因为通知触发模型 turn。
- 不自动批准模糊进化，不把 Telegram 的普通文本当授权，不扩大现有 Promotion policy。
- 首版不做 inline approve/reject 按钮。现有 `/evolve` Commands 已能完成闭环；只有真实可用性数据证明复制命令是主要摩擦，才增加 exact-hash、one-shot、stale-fail-closed 的按钮。
- 不同时开发 Calendar、People DB、第二消息渠道或内容生产插件。

## 最小验收合同

实现前先写失败测试，首版只有以下门：

1. 新 Candidate review 进入 actionable 后，固定私聊收到一条且仅一条 attention；原 Session 没有新增 event、message 或模型请求。
2. 新 Evaluator Draft 进入 actionable 后行为相同；非 actionable、已拒绝、已批准和人工创建但无需处理的状态不发送。
3. crash 分别注入在 `prepared` 前、`prepared` 后和发送结果未知处；重启后只恢复确定可恢复的记录，`uncertain` 不自动重发。
4. 相同 item 重扫、插件热重载、DSH 进程重启都不产生第二条确定性投递。
5. 只有配置的 exact private `chat_id + user_id` 能读取/执行 `/evolve` Command；其它 route 不泄露 review 元数据。
6. stale 或 hash 漂移的 review id 由既有 Control Plane fail closed；通知插件不缓存第二份可执行 Candidate 数据。
7. 启用前后普通 64-turn assembled Session 的模型请求在归一化内部 id 后 byte-equivalent；预期 input/output/cache-read delta 均为 `0`。
8. tarball 安装、真实 Loader boot、禁用、remove 后没有 Tool/Prompt/Skill、poller、listener 或未结算投递残留。
9. 自动化全部通过后，才用用户明确提供的 Bot secret 做真实 Telegram 多日 soak；该步骤验证公网/移动端投递，不授权发布、merge 或任何额外外部动作。

## 决策置信度与停止条件

推荐置信度为 **中等**：attention 的通用价值证据强，当前功能断点明确，实现面小；但 EvoForge 真实 review 频率和用户接受率尚无数据。

若真实试用满足任一条件，应停止扩展而不是继续造平台：

- 30 天内没有产生 actionable review：说明先要改善真实进化信号，而不是增加渠道；
- attention 被打开但处理率仍低：先研究审阅内容、信任或成本是否难以理解；
- 用户主要通过 Web 主动处理且不需要推送：保留插件可选，不提升为默认；
- 第二渠道的用户结果、权限边界和独立维护者都未出现：不提取通用 notification interface。

只有该最小闭环证明“被提醒后更快完成可信审阅”，再考虑日程或第二助理 adapter。
