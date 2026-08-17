# 安装、使用与卸载

EvoForge 只作为 DSH 原生 Bundle 套件运行。本页区分“开发者生成 tarball”和“用户通过 DSH 安装/使用”；仓库测试、源码 import 或独立命令都不是安装。

## 1. 前置条件

- Node.js `^22.19.0 || >=24`、pnpm；
- DeepSeek Harness revision `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）；
- 一个 DSH `web` profile。

当前包尚未发布到 registry。先在本仓生成十一个 `0.1.0-alpha.1.tgz`；这一步只生成 DSH 安装产物，不启动 EvoForge Runtime：

```sh
pnpm install --frozen-lockfile
PACK_DIR="$(mktemp -d)"
for package in \
  dsh-evolve dsh-evolve-web dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-telegram dsh-evolve-attention dsh-goal-continuity \
  dsh-resident dsh-channel-router dsh-feishu
do
  pnpm --filter "$package" pack --pack-destination "$PACK_DIR"
done
```

## 2. 安装与有效配置

```sh
dsh plugin --profile web add "$PACK_DIR"/*.tgz
dsh --profile web --dump-config
```

有效配置应各出现一次：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-goal-continuity`、`dsh-resident`、`dsh-channel-router`、`dsh-feishu`。涉及外部身份、凭据、自动恢复或 OS 部署的 row 应保持 disabled，直到部署者提供完整静态配置。

启动唯一的 DSH Host：

```sh
dsh --profile web
```

## 3. 在 DSH 内使用

在已有 DSH 会话中：

1. `/doctor` 读取原生 Loader entries，返回 readiness，不修复或复制第二份健康状态。
2. `/evolve status` 与 DSH Web 侧栏读取同一个 Host 权威状态。
3. 创建原生 DSH Goal，让 Agent 按需加载 `software-delivery` Skill；`complete_delivery` 通过该 Agent 的 DSH Bash、Sandbox、Approval 和原生 `update_goal` 完成交付。
4. `dsh-github-review` 只把 allowlist 人类对 exact Draft PR head 的修改要求作为有界、不可信 follow-up 送回原 Session。
5. Telegram 与飞书只通过 Channel Router 绑定原生 Workspace/Session/Agent；进化注意力和 Goal cold resume 也不创建第二套会话、目标或调度。
6. Resident 只通过 `/resident plan|status|apply <plan-sha256>|remove <service-id>` 管理 exact OS user unit；先审查 plan，再逐次确认 hash 或 service id。

部署者配置 exact Shadow/Evaluator Target 后，进化资格验证、Shadow、review、promote 和 rollback 仍通过 `/evolve` Commands 或同一 DSH Web Host 完成。Command 和浏览器不接收任意 host path、模型路由或执行权限。

Telegram 示例：

```yaml
- id: evoforge-channel-router
  name: dsh-channel-router
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

飞书使用官方 SDK WebSocket 长连接，不创建 EvoForge Webhook server。一个 App 可列出多个 exact route，但所有 route 的 `accountId` 必须等于部署环境中的 App ID：

```yaml
- id: evoforge-channel-router
  name: dsh-channel-router
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

## 4. 禁用、卸载与回退

禁用单包时，在 profile patch 中覆盖稳定 row 的 `disabled: true`。完全移除：

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-evolve-attention dsh-telegram dsh-goal-continuity \
  dsh-resident dsh-feishu dsh-channel-router
dsh --profile web --dump-config
dsh --profile web
```

卸载后的官方 DSH Bundle 仍保留；Session、Goal、Workspace 和 Storage 继续由 DSH 读取。外部系统已经接受的消息或 PR 效果不能由卸载撤回。

## 5. 开发与 assembled 验收

```sh
pnpm check
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-doctor exec vitest run test/suite-native-plugin-contract.test.ts
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-software-delivery exec vitest run test/clean-profile-suite.e2e.test.ts
pnpm benchmark:hermes
```

clean-profile gate 从全部十一个用户包的 tarball 开始，通过一次官方 DSH CLI 安装、dump、boot，在注册后的原生 Workspace 与真实 Agent preset/Session/Goal 内触发 packed Tool，flush 原生持久化，再一次卸载全部十一包、重启并读回 Goal。它同时检查每个 tarball 无用户产品 bin、无 `node_modules`，且 production dependencies 不携带 DSH/Cordis。

Resident 已有原生 Bundle、DSH Command、无 bin tarball以及 launchd/systemd 协议回归；Channel Router、Telegram 与飞书已通过原生 Bundle、持久 ingress/outbound、真实 DSH Host/Agent Loop、Command、Approval、continuation、429/uncertain、双 Workspace 双渠道重启隔离与 tarball lifecycle。Workspace-scoped evolution、Telegram/飞书进化注意力、十一包同一 clean-profile gate、完整 composition Cache Contract gate 和 v0.1 真实 DSH 浏览器 pause/restart/failure/recovery 复验已通过。EV-1、SD-1、LC-1 与 AS-1 approval 四个确定性 Hermes paired slice 已通过；真实渠道凭据、同模型编码/长任务和真实消息交付 epochs 仍缺失，这些完成前不能发布 v0.1。
