# DeepSeek Harness EvoForge

**EvoForge 是安装进 DeepSeek Harness 的原生 out-of-tree 插件套件，不是独立 Harness、Runtime、CLI、Web 服务或 daemon。** DSH 始终是唯一 Agent Host，以及 Session、Goal、Approval、Storage、Jobs、Skill、Tool 和 Cordis 生命周期权威。

当前兼容性证据固定在 DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）。项目仍为 pre-alpha，尚未发布 registry release；下面的本地 tarball 流程是当前真实、可复制的安装路径。

## 套件

| Bundle | 在 DSH 中提供的能力 | 默认状态 |
|---|---|---|
| `dsh-evolve` | `/evolve`、原生 Storage/Jobs/Session 接缝上的进化控制与 Skill generation | enabled |
| `dsh-evolve-web` | DSH Web 侧栏 client adapter；只读写 `dsh-evolve` 的 Host 权威状态 | enabled |
| `dsh-software-delivery` | 原生 `software-delivery` Skill 与 `complete_delivery` Tool | enabled |
| `dsh-doctor` | 只读 `/doctor` Loader readiness | enabled |
| `dsh-telegram` | 一个授权私聊到一个既有 DSH Agent 的 adapter | disabled，需显式配置 |
| `dsh-goal-continuity` | exact allowlist Session 的原生 Goal cold-resume policy | disabled，需显式配置 |

## 安装到一个 DSH profile

先从仓库生成发布形态的 tarball；这是开发/验收步骤，不是另起 EvoForge Runtime：

```sh
pnpm install --frozen-lockfile
PACK_DIR="$(mktemp -d)"
pnpm --filter dsh-evolve pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-evolve-web pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-software-delivery pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-doctor pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-telegram pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-goal-continuity pack --pack-destination "$PACK_DIR"
```

用 DSH 官方插件命令把产物装进现有 `web` profile：

```sh
dsh plugin --profile web add \
  "$PACK_DIR/dsh-evolve-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-evolve-web-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-software-delivery-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-doctor-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-telegram-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-goal-continuity-0.1.0-alpha.1.tgz"
```

检查官方有效配置并启动同一个 DSH Host：

```sh
dsh --profile web --dump-config
dsh --profile web
```

发布到 registry 后，tarball 参数可替换为相同的六个包名；本仓没有把“尚未发布”的命令冒充已可用安装渠道。

## 在 DSH 会话里直接使用

- 在 DSH 会话输入 `/doctor` 查看当前 Loader readiness。
- 输入 `/evolve status` 查看进化控制面；Web profile 同时加载 EvoForge 侧栏。
- 创建或继续一个原生 DSH Goal，按需加载 `software-delivery` Skill；Agent 在自己的原生 Tool surface 中调用 `complete_delivery`，通过 DSH Bash/Sandbox/Approval 验证后用原生 `update_goal` 完成 Goal。
- `dsh-telegram` 与 `dsh-goal-continuity` 的 Bundle row 默认 disabled。只在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中对稳定 row id 做显式 `disabled: false` 与配置覆盖；见各包 README。

没有 `dsh-evolve` 或 `dsh-delivery` 用户 CLI。测试夹具不是打包入口，核心能力无需另起进程、端口、数据库或任务循环。

## 禁用与卸载

临时禁用时，在 profile 的 `cordis.patch.yml` 覆盖对应稳定 id 为 `disabled: true`，然后由 DSH 重载/重启。完全卸载：

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery \
  dsh-doctor dsh-telegram dsh-goal-continuity
dsh --profile web --dump-config
dsh --profile web
```

插件卸载只移除 EvoForge Bundle/注册/生命周期资源；原生 DSH Session/Goal 数据仍由 DSH Storage 读取。

## 证据与开发

- [中文安装与验收](docs/getting-started.zh.md)
- [全仓产品形态审计](docs/native-plugin-shape-audit.zh.md)
- [插件合同](docs/plugin-contract.zh.md)
- [需求基线](docs/requirements.zh.md)
- [ADR-0041](docs/adr/0041-dsh-is-the-only-runtime-and-install-surface.md)

开发命令 `pnpm check` 与 macOS clean-profile test 只用于构建和验收；用户使用路径始终是上面的 DSH profile。

License: MIT.
