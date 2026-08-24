# V5.21：真实飞书门纳入官方 DSH Schedule

> 日期：2026-08-24
> 状态：AS-2 epoch-2 入口 implemented；真实 direct/group 均 `NOT_RUN`，不是平台通过证据

## 用户结果

真实飞书验收不再只检查入站、普通回复、Command、Approval 和 notice。显式授权的执行还必须从最终
`dsh-gateway`/`dsh-feishu` tarball 组合中，通过官方 agent-scoped `schedule_create` 创建一次提醒，观察同一
原生 Session 的 `schedule/change create`、`schedule/change dispatch` 和来源为官方 Schedule 插件的
`user/message`，并确认生产飞书
exact route 的 durable delivered 计数真实增加。官方卸载两个插件后，原生 DSH 必须仍能读回这些 Schedule 事实。

本增量没有新增 Scheduler、Schedule parser、Gateway causal key、Feishu 私有日程表、Agent Runtime、Session、
Goal、Approval 或产品 CLI。真实平台入口继续使用 keyless deterministic DSH LLM fixture，隔离渠道效果与模型质量。

## 设计与边界

官方 DSH Schedule 只监听加载之后创建的 live 根 Agent，不扫描或接管既有 Agent。因此 AS-2 epoch-2 的私有
profile overlay 保留 Bundle 自动插入的 disabled 声明行，并按以下活动顺序另行插入：

1. keyless DSH LLM fixture；
2. 官方 `@deepseek-ai/dsh-schedule`；
3. 生产 `dsh-gateway` exact route，由它创建原生 Agent；
4. 生产 `dsh-feishu` Adapter。

验收器只通过 DSH `ctx.agents.withInitiator()` 和 `ctx.tools.execute(schedule_create)` 跨官方 Tool 接缝；Gateway
仍只看到普通 Session turn 与既有 `route + turn` intent。Schedule 的模型/token/成本窄窗口语义没有改变。

## 终态不能伪造

benchmark id 从 `as2-feishu-real-channel-epoch-1` 升为
`as2-feishu-real-channel-epoch-2`。新增终态解码器在复用私有 `result.json` 前重验：

- exact benchmark、manifest、EvoForge/DSH revision、App/route hash 与 chat kind；
- 关闭的十一项 boolean observation，包含 `nativeScheduleRoundTrip`；
- `passed` 必须 stage 为 `complete`、十一项全真且 reasons 为空；
- `failed` 必须保留至少一条有界 reason；
- 可选 Gateway facts 必须是关闭字段集中的非负安全整数。

旧 epoch、缺 Schedule 字段、畸形 verdict 或畸形 Gateway facts 不再能阻止一次新的真实执行。未提供精确授权
短语时，入口仍只读取批准变量，退出 2，并且不读取 App/chat/user/Secret、不加载执行模块、不发平台请求。

## 已运行验证

- `pnpm benchmark:feishu:as2:test`：9/9 passed；包含先红后绿的“缺 native Schedule gate 的 retained
  terminal report 必须拒绝”、未授权零秘密读取、缺配置、身份/路径/timeout 拒绝、秘密脱敏与 runner
  `NOT_RUN`。
- `pnpm benchmark:feishu:as2:typecheck`：passed。
- `pnpm --filter dsh-feishu typecheck`：passed。
- `pnpm --filter dsh-feishu test`：18 files / 52 tests passed；覆盖真实 DSH Schedule assembled、两个真实
  `SIGKILL` 窗口、Gateway/Adapter 与包构建。

真实 App ID/Secret 已仅通过运行进程环境注入，最终 tarball 已安装到最新 DSH rc.2 的真实 `web` profile，
生产飞书 WebSocket 配对长连接和 Web 向导已经启动；凭据没有写入仓库或 profile。exact conversation/user
仍待一次性短语配对，因此尚未启动隔离 AS-2 direct/group 执行，二者继续严格为 `NOT_RUN`。上述合同、类型、
assembled Host 和当前配对准备不能替代真实 App/chat/user 的 `status: passed`。

## Cache、权限与发布

生产插件、Tool Schema、Prompt、Skill catalog 和正常请求 composition 均未修改，Cache Contract delta 为 none。
真实平台仍需显式授权短语；凭据只经环境进入私有进程，公开报告只保留哈希。没有 commit 以外的外部效果，
没有 branch、tag、registry release 或生产部署。首个 SemVer tag 继续被真实 direct/group、真实 Provider 与
Hermes 同条件 paired benchmark 阻断。
