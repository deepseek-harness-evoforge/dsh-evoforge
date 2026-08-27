# 安装、使用与卸载

EvoForge 只作为 DSH 原生 Bundle 套件运行。本页区分“开发者生成 tarball”和“用户通过 DSH 安装/使用”；仓库测试、源码 import 或独立命令都不是安装。

## 1. 前置条件

- Node.js `^22.19.0 || >=24`、pnpm；
- DeepSeek Harness revision `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）或当前已审计的
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`0.1.1-rc.2`）；
- 一个 DSH `web` profile。

当前包尚未发布到 registry。先按用户结果生成需要的能力套件；这一步只生成 DSH 安装产物，不启动 EvoForge Runtime：

```sh
pnpm install --frozen-lockfile
PACK_ROOT="$(mktemp -d)"
pnpm run pack:suite -- --suite core --out "$PACK_ROOT"
```

`pack:suite` 省略 `--suite` 时默认仍是面向用户的 `core`；完整十二包只用于维护者验收，并需显式执行
`pnpm run pack:full`。

用户按能力选择套件即可；默认入口是 `core`、`channels`、`delivery`、`continuity`，`attention` 按需安装；完整边界和为什么不物理合并见[能力套件说明](capability-suites.zh.md)。维护者或完整验收使用 `--suite full`。每个输出目录都会包含官方 Bundle 及带 SHA-256/audience 的 `evoforge-suite.json`。

## 2. 安装与有效配置

```sh
dsh plugin --profile web add "$PACK_ROOT/core"/*.tgz
dsh --profile web --dump-config
```

有效配置应分别出现一次 `dsh-evolve`、`dsh-doctor`、`dsh-control-center` 和 `dsh-evolve-web`。渠道、GitHub review、Goal continuity、OS service 和 attention 都是独立可选能力；涉及外部身份、凭据、自动恢复或 OS 部署的 row 应保持 disabled，直到部署者提供完整静态配置。

启动唯一的 DSH Host：

```sh
dsh --profile web
```

## 3. 在 DSH 内使用

在已有 DSH 会话中：

1. `/doctor` 读取原生 Loader entries；若飞书/Telegram 是必需且 active 的模块，再读取现有 Gateway 脱敏
   transport health，返回三态 readiness。它不探测凭据/平台、不修复，也不复制第二份健康状态。
2. DSH Web 的原生“控制台”页统一承载 Gateway、飞书、Telegram、Doctor 和演化 Surface；各 Surface 读取原插件 Host/Command 权威，不调用模型，也不复制状态库。Doctor 与 Telegram 通过已有 `/doctor`、`/telegram` 只读 Command 读取，不创建第二份健康状态。
3. 创建原生 DSH Goal，让 Agent 按需加载 `software-delivery` Skill；`complete_delivery` 通过该 Agent 的 DSH Bash、Sandbox、Approval 和原生 `update_goal` 完成交付。
4. `dsh-github-review` 只把 allowlist 人类对 exact Draft PR head 的修改要求作为有界、不可信 follow-up 送回原 Session。
5. Telegram 与飞书只通过 DSH Gateway 绑定原生 Workspace/Session/Agent；进化注意力和 Goal cold resume 也不创建第二套会话、目标或调度。
6. Resident 只通过 `/resident plan|status|apply <plan-sha256>|remove <service-id>` 管理 exact OS user unit；先审查 plan，再逐次确认 hash 或 service id。

纠正首先保存在当前 Workspace。若内部证据尚未达到资格门，或 Workspace 没有启用对应的治理策略，原生 DSH Web
概览会直接显示等待原因；它不会要求用户选择或配置 Skill、Target 或路径，也不会把“已记录反馈”误报为“已经进化”。
满足策略后，进化资格验证、Shadow、review、promote 和 rollback 仍通过 `/evolve` Commands 或同一 DSH Web Host
完成。Command 和浏览器不接收任意 host path、模型路由或执行权限。

Telegram 示例：

```yaml
- id: evoforge-gateway
  name: dsh-gateway
  disabled: false
  config:
    routes:
      - id: telegram-personal
        adapter: telegram
        accountId: personal-bot
        conversationId: "100000001"
        userId: "200000002"
        workspaceId: 11111111-1111-4111-8111-111111111111
        sessionId: personal-main
        agentPreset: standard
        provider: deepseek-official
        model: deepseek-v4-flash

- id: evoforge-telegram
  name: dsh-telegram
  disabled: false
  config:
    routeId: telegram-personal
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
```

Goal cold-resume 示例：

```yaml
- id: evoforge-goal-continuity
  name: dsh-goal-continuity
  disabled: false
  config:
    autoResumeSessionIds:
      - personal-main
```

token 由启动 DSH 的环境提供。模型不能读取 token、修改 route、选择 Workspace 或扩大 allowlist。

飞书使用官方 SDK WebSocket 长连接，不创建 EvoForge Webhook server。第一次使用无需到后台手工寻找
`chat_id`/`open_id`：先让 `dsh-gateway` 保持 `routes: []`，再把 `evoforge-feishu` 配成：

```yaml
  name: dsh-feishu
  disabled: false
  config:
    mode: pairing
    routeIds: []
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
```

启动 DSH Web 后，Adapter 立即常驻连接。先打开准备绑定的 Workspace/Session，再让用户给飞书机器人发送
任意私聊消息；机器人会在 Agent 之前消费首条消息并回复配对码。打开 DSH Web 原生“控制台”，进入“渠道”
Surface；“待批准请求”会显示这次请求的脱敏 Adapter、有效期和账户指纹。管理员可直接点击“直接批准”，
也可把 code 粘贴到“飞书配对”兼容输入框。用户发送下一条消息即可进入当前原生 Session；不需要改 profile
或重启。群聊、过期
code、重放、无 live Session 和 Workspace ownership 漂移均 fail closed；没有 `/feishu-pair` Command。

需要撤销动态授权时，在同一“渠道”Surface 的“授权路由”区点击对应 route 的“撤销”，再点击一次“确认撤销”。
静态配置 route 不提供该动作；仍有活动入站或出站效果时 Host 会拒绝撤销。成功后原生 Session 保留，该用户
下一条私聊会重新收到配对码。此动作会中断该外部 principal 的后续访问，操作前应确认目标 route。

正常模式下，一个 App 可列出多个 exact route，所有 route 的 `accountId` 必须等于部署环境中的 App ID：

```yaml
- id: evoforge-gateway
  name: dsh-gateway
  disabled: false
  config:
    routes:
      - id: feishu-personal
        adapter: feishu
        accountId: cli_xxxxxxxxxxxxx
        conversationId: oc_xxxxxxxxxxxxx
        userId: ou_xxxxxxxxxxxxx
        workspaceId: 22222222-2222-4222-8222-222222222222
        sessionId: feishu-personal-main
        agentPreset: standard
        provider: deepseek-official
        model: deepseek-v4-flash

- id: evoforge-feishu
  name: dsh-feishu
  disabled: false
  config:
    routeIds: [feishu-personal]
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
```

飞书 Adapter 会自动采用启动 DSH 进程中的 `HTTPS_PROXY`/`https_proxy` 或
`ALL_PROXY`/`all_proxy`，并遵守 `NO_PROXY`/`no_proxy`。该设置只作用于此飞书连接，
不改写环境或 Node 全局 Agent。

## 4. 禁用、卸载与回退

当前尚未发布 registry 版本；本地最终 tarball 的升级继续使用 DSH 官方插件命令，把新一组 exact tarball spec
交给同一 profile。该操作由 DSH 转发给 pnpm 并按安装后事实重新协调 Bundle 层：

```sh
dsh plugin --profile web add /absolute/path/to/new-pack/*.tgz
dsh --profile web --dump-config
dsh --profile web
```

升级前应停止对应 profile；不要手工改 `node_modules` 或 `dsh.profile.bundles`。首个正式 tag 发布后，发布门还会
固定 tag→tag 迁移矩阵；当前 V5.14 只证明冻结的 pre-release predecessor 到当前最终包。

禁用单包时，在 profile patch 中覆盖稳定 row 的 `disabled: true`。完全移除一个已安装套件（以 evolution + control 为例）：

```sh
dsh plugin --profile web remove \
  dsh-evolve dsh-doctor dsh-control-center dsh-evolve-web
dsh --profile web --dump-config
dsh --profile web
```

卸载后的官方 DSH Bundle 仍保留；Session、Goal、Workspace 和 Storage 继续由 DSH 读取。外部系统已经接受的消息或 PR 效果不能由卸载撤回。

## 5. 开发与 assembled 验收

```sh
pnpm check
pnpm test:suite-upgrade
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-doctor exec vitest run test/suite-native-plugin-contract.test.ts
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-software-delivery exec vitest run test/clean-profile-suite.e2e.test.ts
pnpm benchmark:hermes
```

clean-profile gate 仍从全部十二个内部 Bundle 的 tarball 开始，通过一次官方 DSH CLI 安装、dump、boot，在注册后的原生 Workspace 与真实 Agent preset/Session/Goal 内触发 packed Tool，flush 原生持久化，再一次卸载全部包、重启并读回 Goal。用户不必安装全包；能力套件只是对这套真实 Bundle 的精简安装编排。它同时检查每个 tarball 无用户产品 bin、无 `node_modules`，且 production dependencies 不携带 DSH/Cordis。

Resident 已有原生 Bundle、DSH Command、无 bin tarball以及 launchd/systemd 协议回归；DSH Gateway、Telegram 与飞书已通过原生 Bundle、持久 ingress/outbound、真实 DSH Host/Agent Loop、Command、Approval、continuation、429/uncertain、双 Workspace 双渠道重启隔离与 tarball lifecycle。Workspace-scoped evolution、Telegram/飞书进化注意力、十二包同一 clean-profile gate、完整 composition Cache Contract gate，以及 Evolution/Doctor/Telegram loopback 的 DSH 浏览器路径已通过；真实飞书 App 身份请求和标准代理环境 WebSocket 握手也已通过。完整渠道控制面新人路径、真实 Telegram Bot、真实飞书 AS-2、同模型编码/长任务和真实消息交付 epochs 仍缺失，这些完成前不能发布 v0.1。本轮按项目所有者要求不验证 Telegram。
