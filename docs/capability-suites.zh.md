# 能力套件与内部插件边界

EvoForge 对用户不再把十二个内部 Bundle 当成十二个必须理解的产品。默认公开安装面收敛为四个入口：`core`、`channels`、`delivery`、`continuity`；`attention` 是可选附加能力，`evolution`、`control`、`gateway` 只保留为兼容/高级入口，`full` 仅供维护者验收。每个套件仍由 DSH 官方命令安装真实 Bundle；套件清单只是可重复的安装编排，不是第二个 Runtime、CLI 或插件市场。物理边界的逐包审计见[2026-09-03 插件边界审计](audits/2026-09-03-package-boundary-audit.zh.md)。

## 默认用户入口

| 套件 | 包含的内部 Bundle | 适合谁 | 默认影响 |
|---|---|---|---|
| `core` | `dsh-evolve`、`dsh-doctor`、`dsh-control-center`、`dsh-evolve-web` | 自我进化闭环、运行诊断和 DSH Web 控制面 | 四个 Bundle 仍可独立禁用/卸载；不新增模型表面 |
| `channels` | `dsh-control-center`、`dsh-gateway`、`dsh-feishu`、`dsh-telegram` | 需要飞书/Telegram 私聊、配对和持久投递，并在同一个 DSH Web 页面管理渠道 | 包含一个无模型的原生控制面；不强制安装自我进化或通知层；渠道 Adapter 默认 disabled，必须提供精确凭据和路由 |
| `delivery` | `dsh-software-delivery`、`dsh-github-review` | 需要隔离交付、Draft PR 和原生 Session 内的 GitHub review 跟进 | Skill/Tool 表面按 DSH 原生规则固定；外部 GitHub 写入仍受保护动作约束 |
| `continuity` | `dsh-goal-continuity`、`dsh-resident` | 需要有限 Goal 冷恢复和登录后常驻 DSH profile | 两项均 opt-in；不创建第二 Scheduler、Daemon 或状态库 |

## 可选与兼容入口

| 入口 | 包含的 Bundle | 用途 |
|---|---|---|
| `attention` | `dsh-evolve-attention` | 已配置飞书/Telegram 后，投递需要处理的进化提醒；不创建第二 Gateway 或通知运行时 |
| `evolution` | `dsh-evolve`、`dsh-doctor` | 旧脚本兼容入口；新安装请使用 `core` |
| `control` | `dsh-control-center`、`dsh-evolve-web` | 旧脚本兼容入口；新安装请使用 `core` |
| `gateway` | `dsh-gateway` | 高级入口，仅用于接入第三方 Adapter |
| `full` | 全部十二包 | 维护者、完整验收；不作为普通用户默认安装选项 |

生成一个套件的发布包：

```sh
pnpm run pack:suite -- --suite core --out /tmp/evoforge-packs
```

省略 `--suite` 时默认生成 `core`，避免新用户无意安装维护者用的完整组合；需要完整十二包验收时必须显式使用
`pnpm run pack:full` 或 `--suite full`。

如果只使用一个消息渠道，可以在打包时进一步减少已安装文件：

```sh
pnpm run pack:suite -- --suite channels --channel feishu --out /tmp/evoforge-packs
# 或：--channel telegram
```

这会生成共享控制面、`dsh-gateway` 与所选 Adapter；它是安装层筛选，不会把控制面、Gateway 与平台 Adapter 合成一个 Bundle。

脚本会为套件中的每个包运行官方 `pnpm pack`，并写出带 SHA-256 和 `audience`（default/optional/compatibility/maintainer）的 `evoforge-suite.json`。安装仍由 DSH 负责：

```sh
dsh plugin --profile web add /tmp/evoforge-packs/evolution/*.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

Host 只启动一次；启动日志打印的 URL 应复用到已有 DSH 浏览器标签页。刷新页面不需要再次执行启动命令，常驻服务也默认
使用 `--no-open`，因此不会为每次重启创建新网页。

卸载使用清单中的包名：

```sh
dsh plugin --profile web remove dsh-evolve dsh-evoforge-doctor dsh-control-center dsh-evolve-web
```

## 为什么不把十二包物理合成一个包

这不是为了凑数量。下面的边界对应真实的生命周期、权限或依赖变化，合并会让安装看似简单，却让卸载、升级、缓存和故障恢复更难验证：

| 边界 | 必须保留的原因 |
|---|---|
| `dsh-evolve` / `dsh-doctor` | 进化拥有 Storage、Jobs、Skill 和治理状态；Doctor 是零模型、只读 Loader/transport 诊断。把诊断拖进进化会让最小安装承担不必要的依赖和权限。 |
| `dsh-control-center` / 各 Web Adapter | Control Center 是一个公共原生视图和 child slot；Gateway、Feishu、Evolution 各自读取自己的 Host 权威。合并会重新制造一个全局 registry 和跨插件状态库。 |
| `dsh-gateway` / `dsh-feishu` / `dsh-telegram` | Gateway 负责平台中立的配对、Workspace/Session 路由、durable delivery 和幂等；Adapter 负责 SDK、凭据、WebSocket/reconnect 和平台协议。合并会把凭据权限和路由权限绑死。 |
| `dsh-evolve` / `dsh-evolve-attention` | 进化闭环不应依赖消息渠道；Attention 只是可卸载的通知 Adapter。没有渠道时，核心进化仍应可用。 |
| `dsh-software-delivery` / `dsh-github-review` | 交付是本地 worktree/验证/Draft PR 结果；review 是外部 GitHub 读取后回到原生 Session 的不可信输入。两者的 token、网络和信任边界不同。 |
| `dsh-goal-continuity` / `dsh-resident` | Continuity 是原生 Goal 冷恢复策略；Resident 是 launchd/systemd 用户服务计划。一个属于 Agent 生命周期，一个属于 OS service authority。 |

## 已删除的重复入口

- `dsh-evolve-web` 不再注册 `sidebar.footer.action` 固定弹窗；它现在贡献 `evoforge.control.surface`，和 Gateway/Feishu 共用同一个原生 Control Center 页面。
- Gateway/Feishu 不再各自拥有页面外的固定健康对话框；渠道协议、投递和配对事实仍只由 Host Adapter/Gateway 提供。
- `dsh-evolve` 的 Observer、Candidate、Trial、Promotion、Rollback 等内部阶段不是可安装插件；它们共同构成一个演化用户结果。

因此精简的是“用户要选择和维护的产品入口”，不是把必须独立启停、卸载、权限审计的运行边界抹掉。`channels` 包含轻量 `dsh-control-center`，确保只安装渠道时仍有一个网页完成配对批准和健康查看；它不带自我进化、诊断或 `attention`，需要这些能力时再安装 `core` 或 `attention`。
