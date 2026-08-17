# DeepSeek Harness EvoForge

**EvoForge 是安装进 DeepSeek Harness 的原生 out-of-tree 插件套件，不是独立 Harness、Runtime、CLI、Web 服务或 daemon。** DSH 始终是唯一 Agent Host，以及 Session、Goal、Approval、Storage、Jobs、Skill、Tool、Workspace 和 Cordis 生命周期权威。

当前兼容性证据固定在 DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）。项目仍为 pre-alpha，尚未发布 registry release；当前真实安装路径是本地 tarball 加 DSH 官方 profile 命令。

## 当前套件

| 包 | DSH 内能力 | 默认状态 |
|---|---|---|
| `dsh-evolve` | `/evolve`、Storage/Jobs/Session 上的证据驱动进化与 Skill Generation | enabled |
| `dsh-evolve-web` | DSH Web Client Module；只投影 `dsh-evolve` 的 Host 权威状态 | enabled |
| `dsh-software-delivery` | 原生 `software-delivery` Skill 与 `complete_delivery` Tool | enabled |
| `dsh-doctor` | 原生 `/doctor` Loader readiness | enabled |
| `dsh-github-review` | Draft PR exact-head 人类返修回到原 Session/Goal | disabled，需显式配置 |
| `dsh-telegram` | 一个授权私聊到一个既有 DSH Agent/Session 的 Adapter | disabled，需显式配置 |
| `dsh-evolve-telegram` | 把进化待决事项投影到既有 Telegram route | disabled，需显式配置 |
| `dsh-goal-continuity` | exact allowlist Session 的原生 Goal cold-resume policy | disabled，需显式配置 |
| `dsh-resident` | `/resident` 管理 exact DSH profile 的 launchd/systemd user unit | disabled，需显式配置与逐次确认 |
| `dsh-channel-router` | external endpoint 到原生 Workspace/Session/Agent 的静态、幂等绑定 | disabled，需显式配置 |

现有进化实现覆盖 P0A–P1.21：sealed paired Trial、inactive Candidate、immutable Generation、Session pin、人工审查、极窄自动晋升、Retention、预算、反馈驱动 Shadow、反事实 canary 和 future-session rollback。它们仍处于 `implemented`，真实 provider、陌生用户、长期误晋升率和生产多日证据尚未完成。

## 安装到一个 DSH profile

先生成发布形态 tarball；这只是开发/验收步骤，不会启动第二个 Runtime：

```sh
pnpm install --frozen-lockfile
PACK_DIR="$(mktemp -d)"
for package in \
  dsh-evolve dsh-evolve-web dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-telegram dsh-evolve-telegram dsh-goal-continuity \
  dsh-resident dsh-channel-router
do
  pnpm --filter "$package" pack --pack-destination "$PACK_DIR"
done
```

使用 DSH 官方插件命令安装并检查同一个 Host：

```sh
dsh plugin --profile web add "$PACK_DIR"/*.tgz
dsh --profile web --dump-config
dsh --profile web
```

默认关闭的包只有在部署者通过 profile patch 提供 exact 身份、路由、凭据引用或 Session allowlist 后才能启用。模型不能选择 token、外部身份、Workspace、目标 Agent 或扩大权限。

## 在 DSH 内使用

- `/doctor` 查看当前组合 readiness；
- `/evolve status` 或 DSH Web 侧栏查看和处理进化状态；
- 在原生 Goal 中按需加载 `software-delivery` Skill，由 `complete_delivery` 通过 DSH Bash/Sandbox/Approval 验证并调用原生 `update_goal`；
- `/resident plan|status|apply <plan-sha256>|remove <service-id>` 通过 DSH Command 审查和管理 OS user unit；
- Telegram、GitHub review、Goal continuity 和进化注意力只复用已有 DSH Agent、Session、Goal 与 Commands。

没有 `dsh-evolve`、`dsh-delivery` 或 `dsh-resident` 用户产品 CLI。测试驱动器不是打包入口。

## 卸载

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-evolve-telegram dsh-telegram dsh-goal-continuity \
  dsh-resident dsh-channel-router
dsh --profile web --dump-config
dsh --profile web
```

卸载只移除 EvoForge 注册与生命周期资源；原生 DSH Session、Goal 和 Workspace 数据仍由 DSH 读取，已经发生的外部效果不能由卸载撤回。

## 当前 v0.1 工作

Workspace Channel Router core 已实现：静态 exact endpoint、原生 Workspace/Session/Agent 绑定、持久 ingress 幂等与双 Workspace 隔离合同已通过。下一交付面是把 Telegram 迁为第一个 Adapter、增加飞书作为第二个 Adapter，并使 Evolution 的 Candidate/Generation/预算/审查严格按 Workspace 隔离。完成声明还需要十包 clean-profile tarball 装配、双 Workspace 真实渠道链路、完整 composition cache gate、真实浏览器、可用凭据下的飞书/Telegram 冒烟以及 Hermes paired benchmark。

- [安装与验收](docs/getting-started.zh.md)
- [当前状态](docs/status.zh.md)
- [产品形态审计](docs/native-plugin-shape-audit.zh.md)
- [插件合同](docs/plugin-contract.zh.md)
- [需求基线](docs/requirements.zh.md)
- [ADR-0041](docs/adr/0041-dsh-is-the-only-runtime-and-install-surface.md)

License: MIT.
