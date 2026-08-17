# 安装、使用与卸载

EvoForge 只作为 DSH 原生 Bundle 套件运行。本页区分“开发者生成 tarball”和“用户通过 DSH 安装/使用”；仓库测试、源码 import 或独立命令都不是安装。

## 1. 前置条件

- Node.js `^22.19.0 || >=24`、pnpm；
- DeepSeek Harness 目标 revision `47f943859bef60e4160492346772ded9b24f765a`；
- 一个 DSH `web` profile。官方模板自带原生 Storage、Session、Goal、Agent preset、Skill、Tool、Approval 与 Web Host。

当前包尚未发布到 registry，所以先在本仓执行 README 的六条 `pnpm --filter <package> pack`，得到六个 `0.1.0-alpha.1.tgz`。这一步只生成安装产物，不启动 EvoForge。

## 2. 安装与有效配置

```sh
dsh plugin --profile web add \
  /absolute/path/dsh-evolve-0.1.0-alpha.1.tgz \
  /absolute/path/dsh-evolve-web-0.1.0-alpha.1.tgz \
  /absolute/path/dsh-software-delivery-0.1.0-alpha.1.tgz \
  /absolute/path/dsh-doctor-0.1.0-alpha.1.tgz \
  /absolute/path/dsh-telegram-0.1.0-alpha.1.tgz \
  /absolute/path/dsh-goal-continuity-0.1.0-alpha.1.tgz

dsh --profile web --dump-config
```

有效配置应各出现一次：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-telegram`、`dsh-goal-continuity`。后两项应保持 `disabled: true`，直到部署者明确授权。

启动 DSH：

```sh
dsh --profile web
```

## 3. 在 DSH 内使用

在已有 DSH 会话中：

1. `/doctor` 读取当前原生 Loader entries，返回三态 readiness，不修复或保存第二份健康状态。
2. `/evolve status` 与 DSH Web 侧栏读取同一 `dsh-evolve` Host 状态。
3. 创建一个原生 DSH Goal，并让 Agent 使用 `software-delivery` Skill。`complete_delivery` 在该 Agent 的 Tool surface 中执行 DSH 原生 Bash，最后调用原生 `update_goal`。它不允许用旁路 verifier 完成 Goal。

部署者配置 exact `shadowTargets` / `evaluatorTargets` 后，显式进化动作也只在 DSH 内执行：
`/evolve feedback <signal-id> shadow <target-id>` 或
`/evolve feedback <signal-id> author <evaluator-target-id>` 提交 native Job；资格验证、Shadow 与 review
继续使用 `/evolve evaluator ...`、`/evolve review ...` 或同一 Host 的 Web adapter。Command/浏览器不接收
host path、Case Pack hash 或任意执行参数。

如需 Telegram，在 `$DSH_HOME/profiles/web/cordis.patch.yml` 对 Bundle row 做完整配置覆盖：

```yaml
- id: evoforge-telegram
  name: dsh-telegram
  disabled: false
  config:
    agentId: personal-main
    chatId: 100000001
    userId: 200000002
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
```

如需 cold-resume Goal continuation：

```yaml
- id: evoforge-goal-continuity
  name: dsh-goal-continuity
  disabled: false
  config:
    autoResumeSessionIds:
      - personal-main
```

两者都复用既有 DSH Agent/Session/Goal。Telegram token 由启动 DSH 的环境提供；插件不会创建 daemon 或 webhook server。

## 4. 禁用、卸载与回退

禁用单包时，在 profile patch 中覆盖该稳定 row 的 `disabled: true`。完全移除：

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery \
  dsh-doctor dsh-telegram dsh-goal-continuity

dsh --profile web --dump-config
dsh --profile web
```

卸载后的有效配置不应包含任何 EvoForge row；官方 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` 仍保留。原生 Session/Goal JSONL、Storage 与 Agent 恢复仍由 DSH 读取。外部系统已经接受的 Telegram 消息无法由卸载撤回。

## 5. 开发与 assembled 验收

```sh
pnpm check
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-doctor exec vitest run test/suite-native-plugin-contract.test.ts
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-software-delivery exec vitest run test/clean-profile-suite.e2e.test.ts
```

第二条 assembled test 仅在 macOS 运行。它 pack 六包、通过官方 DSH CLI 装进隔离的 `web` profile、dump/boot、在真实 Agent preset/Session/Goal 内执行软件交付、flush 原生持久化、卸载、再次 boot 并读回 Goal 事件，同时检查 tarball 无 bin、无 `node_modules` 和无 DSH/Cordis production dependency。

测试目录中的 Shadow driver 是不打包的开发夹具，不能作为用户入口。
