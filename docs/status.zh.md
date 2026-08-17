# 当前实现状态

> 更新日期：2026-08-17。本文只描述当前权威集成工作树，不把计划或历史分支当作已交付能力。

## 状态词

| 状态 | 含义 |
|---|---|
| `planned` | 尚无可运行实现 |
| `implemented` | 源码和自动化测试存在，真实环境或发布证据仍不足 |
| `verified` | 对应退出门有可复核的真实证据 |
| `released` | 已发布并验证安装、升级和卸载 |

## 当前总判断

EvoForge 已有大量 `implemented` 能力，但 v0.1 **未完成**。最新能力与 ADR-0041 原生插件修正已经进入同一集成工作树；仍需完成 Resident 插件化、Workspace Channel Router、飞书、双 Workspace evolution 隔离和完整验收。

| 能力 | 当前状态 | 已有证据 | 仍缺 |
|---|---|---|---|
| 原生 DSH 插件产品形态 | `implemented`，整合中 | `dsh-evolve`、Web、Delivery、Doctor、GitHub Review、Telegram、Attention、Goal Continuity 已有 Bundle/生命周期测试 | Resident 仍有独立 bin；全九包 clean-profile gate 未完成 |
| Evidence-driven Evolution P0A–P1.21 | `implemented` | paired Trial、Generation、Session pin、review、Retention、预算、canary、64 轮 cache parity | Workspace 归属、真实 provider、长期误晋升/回滚数据 |
| Software Delivery P2A–P2D | `implemented` | 真实 Git、原生 Tool/Goal、Draft PR、checks 与 Outcome 测试 | 插件整合后 clean-profile 回归、真实长期任务 |
| GitHub Review Follow-up P3.2 | `implemented` | exact-head allowlist、bounded follow-up、重启去重、cache parity | 真实 reviewer 返修闭环和多日 resident |
| Web Control Plane | `implemented` | 真实 DSH Remote/Client Module、Chrome 审查与刷新 | v0.1 集成后的浏览器复验、陌生用户数据 |
| Runtime Readiness | `implemented` | 原生 Loader/Command、tarball 生命周期 | v0.1 全包诊断和陌生安装数据 |
| Telegram 单私聊 | `implemented` | Agent Loop、Commands、Approval、Goal/Schedule、durable delivery、cache parity | Workspace Router 迁移、真实 Bot 冒烟和多日证据 |
| Evolve Telegram Attention | `implemented` | actionable state、durable notice、request parity | 公共 Channel Router 迁移和双 Adapter |
| Goal Continuity | `implemented` | JSONL cold resume、SIGKILL、原生 Goal round limit | 多 Workspace 绑定、生产 soak |
| Resident OS unit | `implemented` 算法，非合格产品形态 | launchd/systemd plan/apply/status/remove 与 macOS crash 测试 | 移除独立 bin，迁入 DSH Command/Approval/Bundle |
| Workspace Channel Router | `planned` | DSH 已提供原生 `WorkspaceRegistry` | 路由模块、持久状态、双 Workspace 隔离测试 |
| 飞书 Adapter | `planned` | 无 | 协议实现、授权、Approval、投递恢复、真实冒烟 |
| Hermes paired benchmark | `planned` | 历史架构记分卡 | 使用 v0.1 同一场景可复跑对照 |
| Registry release | `planned` | 无 | 全部门禁、版本矩阵、用户授权 |

## 当前可安装面

八个包可生成 tarball 并通过 `dsh plugin --profile web add` 安装：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-telegram`、`dsh-goal-continuity`。外部路由和自动恢复默认关闭。

`dsh-resident` 暂不属于用户安装面。没有任何 EvoForge 独立 Runtime、网站或 daemon 是受支持产品入口。

## 当前限制

- 固定 rc.5 源码是唯一支持证据；兼容范围不能由宽 peer range 推断；
- 飞书、多 Workspace route 和 Workspace-scoped evolution 尚未实现；
- 真实 Telegram/飞书凭据、真实 provider、陌生用户和生产多日证据仍缺失；
- 自动化 `implemented` 不能替代真实 outcome，也不能支持笼统的“优于 Hermes”；
- 不 merge、不发布 registry、不部署生产，除非用户另行授权。
