# 插件物理边界审计（2026-09-03）

## 结论

当前仓库有 12 个 DSH Bundle，但用户不需要按 12 个插件理解或安装。`scripts/suite-manifest.mjs` 已将公开入口
收敛为 `core`、`channels`、`delivery`、`continuity` 四个能力套件；`attention` 是显式可选附加能力，
`evolution`、`control`、`gateway` 只是兼容入口，`full` 仅供维护者验收。物理 Bundle 只有在生命周期、权限、
运行时依赖或外部副作用确实不同的情况下才保留。

## 逐包审计

| Bundle | 决策 | 不合并的可验证理由 |
|---|---|---|
| `dsh-evolve` | 保留 | Host 侧自我进化、原生 Goal/Jobs/Storage/Skill 依赖和候选治理；不能依赖渠道或浏览器才能运行。 |
| `dsh-evolve-web` | 保留为客户端 Adapter | 只负责把 Evolution Remote 注册到 DSH 原生 `conversation.view` child slot；与 Host Bundle 的浏览器构建、Remote 生命周期和 peer 依赖不同。它不再创建第二页或状态库。 |
| `dsh-control-center` | 保留 | 只拥有一个原生 DSH Web view 和通用 Surface slot，Host 半部故意无状态；Gateway、Evolution、Doctor、Adapter 通过该 seam 贡献 UI。与任何业务 Bundle 合并会让最小渠道安装失去统一控制面。 |
| `dsh-gateway` | 保留 | 常驻 Host、配对、路由、持久投递、幂等和权限边界的唯一权威；不能复制进每个 Adapter。 |
| `dsh-feishu` | 保留 | 飞书 SDK/WebSocket、App 凭据、内容权限和平台消息语义是独立外部信任域；只消费 Gateway seam。 |
| `dsh-telegram` | 保留 | Telegram 凭据、长轮询和群/私聊策略不同；不把第二个平台硬塞进飞书或 Gateway。 |
| `dsh-evolve-attention` | 保留为可选 Adapter | 只订阅 Evolution settled 事件并向已配置渠道发送提醒，拥有独立通知策略和渠道依赖；不参与核心进化、不拥有审批权，也不新增 Gateway。默认套件不安装它。 |
| `dsh-doctor` | 保留 | 零模型调用的 `/doctor` 诊断命令和只读 Surface；其故障语义不同于演化控制或渠道投递，且可在没有 Evolution 时独立使用。 |
| `dsh-software-delivery` | 保留 | Worktree、Sandbox、Approval 和交付证据是代码副作用边界；不能与进化候选或渠道消息共享写权限。 |
| `dsh-github-review` | 保留为交付附加包 | 外部 GitHub 评论是不可信输入，拥有独立 allowlist 和 Draft PR 信任边界；不应强制所有 DSH 用户安装。 |
| `dsh-goal-continuity` | 保留为可选策略 | 只控制原生 Goal 的冷恢复，复用 DSH Session/Goal；与操作系统服务生命周期无关。 |
| `dsh-resident` | 保留为可选 Host 命令 | 只管理当前 profile 的 launchd/systemd 用户服务，需要 OS 权限、精确路径和二次确认；不能并入 Goal 策略或 Gateway。 |

## 已删除/禁止复活的冗余

- `dsh-channel-router` 已由 `dsh-gateway` 取代，活动源码不再保留第二 Router。
- ClawHub、市场搜索、运行时外部 Skill 下载/导入、Git Skill source/ref、静态 target、Feedback/Evaluator Draft、
  Shadow 内 proposer、旧 canary/attention Web 表面均不属于当前产品入口。
- Gateway、Adapter、Evolution、Doctor 和 Control Center 不各自维护渠道/进化状态副本；Web 只读取各自 Host/Remote
  权威投影。

## 用户安装决策

```text
只要自我进化和诊断       -> core
只要常驻 Gateway/飞书     -> channels --channel feishu
只要交付                 -> delivery
只要冷恢复/系统常驻       -> continuity
需要进化提醒              -> 另装 attention
```

这次审计没有为了“少几个目录”破坏独立卸载、权限审计或外部信任边界；精简发生在用户入口、默认安装和状态
所有权，而不是把本应隔离的生命周期强行合并。后续若新增 Adapter，必须先证明新的凭据/协议/权限/故障域，
否则不得新增 Bundle。
