# 能力套件与内部插件边界

EvoForge 对用户不再把十二个内部 Bundle 当成十二个必须理解的产品。当前公开安装面按用户结果收敛为六类能力，另保留一个 `full` 维护者套件。每个套件仍由 DSH 官方命令安装真实 Bundle；套件清单只是可重复的安装编排，不是第二个 Runtime、CLI 或插件市场。

## 用户可见的能力套件

| 套件 | 包含的内部 Bundle | 适合谁 | 默认影响 |
|---|---|---|---|
| `evolution` | `dsh-evolve`、`dsh-doctor` | 希望从真实 DSH Goal 经验形成可隔离评测的 Skill 版本，并能诊断运行就绪状态 | 无模型表面新增；候选不自动安装或改变当前 Session |
| `control` | `dsh-control-center`、`dsh-evolve-web` | 需要在 DSH Web 查看进化、状态和治理动作 | 一个原生 `conversation.view`；不复制 Host 状态、不调用模型 |
| `gateway` | `dsh-gateway` | 作为其他消息 Adapter 的常驻、授权、路由和投递基础 | 默认 disabled；没有 Adapter 时不产生渠道连接 |
| `channels` | `dsh-gateway`、`dsh-feishu`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-control-center` | 需要飞书/Telegram 私聊、配对、持久投递和进化提醒 | 渠道 Adapter 默认 disabled，必须由部署者提供精确凭据和路由 |
| `delivery` | `dsh-software-delivery`、`dsh-github-review` | 需要隔离交付、Draft PR 和原生 Session 内的 GitHub review 跟进 | Skill/Tool 表面按 DSH 原生规则固定；外部 GitHub 写入仍受保护动作约束 |
| `continuity` | `dsh-goal-continuity`、`dsh-resident` | 需要有限 Goal 冷恢复和登录后常驻 DSH profile | 两项均 opt-in；不创建第二 Scheduler、Daemon 或状态库 |
| `full` | 全部十二包 | 维护者、完整验收和需要全部能力的部署 | 仍按各 Bundle 的默认 disabled/权限门生效 |

生成一个套件的发布包：

```sh
pnpm run pack:suite -- --suite evolution --out /tmp/evoforge-packs
```

脚本会为套件中的每个包运行官方 `pnpm pack`，并写出带 SHA-256 的 `evoforge-suite.json`。安装仍由 DSH 负责：

```sh
dsh plugin --profile web add /tmp/evoforge-packs/evolution/*.tgz
dsh --profile web --dump-config
dsh --profile web
```

卸载使用清单中的包名：

```sh
dsh plugin --profile web remove dsh-evolve dsh-doctor
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

因此精简的是“用户要选择和维护的产品入口”，不是把必须独立启停、卸载、权限审计的运行边界抹掉。
