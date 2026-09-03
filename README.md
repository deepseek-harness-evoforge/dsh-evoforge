# DeepSeek Harness EvoForge

EvoForge 是一组安装到 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的原生插件。它把常驻渠道、可追踪的内部经验进化、软件交付和统一 Web 控制面接到 DSH 的 Bundle、Cordis、Agent、Session、Goal、Skill、Tool、Approval、Jobs 和 Workspace 上。

DSH 仍然是唯一的 Agent Host 和状态权威。EvoForge 不是 Codex 插件，不 fork DSH，不另造 Session、Goal、Agent Runtime、Scheduler、权限系统或插件市场。

## 当前状态

项目目前是 `pre-alpha`：源码、测试和本地 tarball 安装路径可供开发者复现，但尚未发布 registry 稳定包，也还没有声明已经完成 Hermes 上位替代。DSH 最新公开 tag 是 `dsh-v0.1.2-rc.1`（revision `a66e4702047846cdaa10c66c9d3df3951f5ea70d`），最新远端 `master` 已推进到 `76fda729799fe9b3848dbe2c211d4b231032b81e`；两者的干净完整构建都被上游根级 tsdown 入口阻断。当前已完成矩阵的可构建基线仍是 `dsh-v0.1.2-alpha.5`（revision `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`）。每次开发和测试都必须先核对 DSH revision、版本和 clean worktree；rc.1/master 的状态见 [迁移审计](docs/research/dsh-rc1-migration-audit-2026-09-03.zh.md)。

当前尚未关闭的发布门包括：真实飞书完整 AS-2、两套独立真实 provider、同任务同模型同权限同预算的 Hermes paired benchmark、长期负迁移/遗忘数据，以及真实浏览器成功/失败/恢复的完整路径。门禁未全部通过前，不应把本项目当作稳定生产发行版。

## 能力套件

用户只需要选择结果，不需要理解内部 Bundle 数量：

| 套件 | 提供的结果 | 内部包 |
|---|---|---|
| `core` | 自我进化证据链、诊断和 DSH Web 控制面 | `dsh-evolve`、`dsh-doctor`、`dsh-control-center`、`dsh-evolve-web` |
| `channels` | 常驻 Gateway、飞书/Telegram 配对、路由、持久投递和一个原生 DSH Web 控制面 | `dsh-control-center`、`dsh-gateway`、`dsh-feishu`、`dsh-telegram` |
| `delivery` | 原生 Skill/Tool 软件交付、隔离验证、Draft PR 和 GitHub review | `dsh-software-delivery`、`dsh-github-review` |
| `continuity` | Goal 冷恢复和用户级 DSH profile 常驻 | `dsh-goal-continuity`、`dsh-resident` |

`attention` 是可选提醒层；`evolution`、`control`、`gateway` 是兼容/高级入口；`full` 只给维护者做完整验收。内部包保持独立，是因为它们的生命周期、权限和外部依赖不同，必须能够单独启停、卸载和审计；用户入口已经收敛，不需要安装者逐个管理十二个包。详见[套件边界](docs/capability-suites.zh.md)。

## 安装

先准备 Node.js 22.19+、pnpm 11，并安装与本项目匹配的 DSH alpha.5。然后在本仓库执行：

```sh
pnpm install --frozen-lockfile
pnpm run pack:suite -- --suite core --out ./dist/evoforge-packs
dsh plugin --profile web add ./dist/evoforge-packs/core/*.tgz
dsh --profile web --dump-config
```

按需安装渠道或交付能力：

```sh
pnpm run pack:suite -- --suite channels --channel feishu --out ./dist/evoforge-packs
dsh plugin --profile web add ./dist/evoforge-packs/channels-feishu/*.tgz

pnpm run pack:suite -- --suite delivery --out ./dist/evoforge-packs
dsh plugin --profile web add ./dist/evoforge-packs/delivery/*.tgz
```

`pack:suite` 使用 DSH 官方 `pnpm pack` 生成真实 Bundle，并写出带 SHA-256 的 `evoforge-suite.json`。安装、启动、查看配置、停止和卸载仍由 DSH 官方命令完成；EvoForge 不启动第二个后台 Runtime。完整安装和清理命令见[开始使用](docs/getting-started.zh.md)与[发布/安装门](docs/releasing.zh.md)。

## 第一次使用飞书

安装 `channels` 后，在同一个 DSH profile 启用 Gateway 和 `dsh-feishu`，并通过环境变量提供飞书 App ID/Secret。Gateway 是常驻 Host：Adapter 启动即连接，陌生用户在飞书私聊机器人发送任意消息后，会先收到一次性配对码；首条消息不会进入 Agent。管理员在 DSH Web 的“控制台 → 渠道”页面批准待处理请求，用户发送下一条消息即可进入绑定的原生 DSH Session，不需要 Session 命令、不需要打开第二个网页、不需要重启。

飞书配置、最小权限内容读取、撤销和故障语义见 [`dsh-feishu` 用户文档](packages/dsh-feishu/README.md)；Gateway 的路由、持久投递和配对边界见 [`dsh-gateway` 用户文档](packages/dsh-gateway/README.md)。普通文件、音频和视频目前受 DSH 原生 attachment v1 限制，项目不会用伪造 block 冒充支持。

## 自我进化是什么

入口只接受自然语言 Goal、材料、约束、权限和验收标准。系统使用 DSH 原生能力盘点当前已安装 Skill，在真实 Goal 的成功、失败、纠正、返工和外部结果中形成可归因证据；当同一 Workspace 内出现可复核的重复缺口时，才进入 Opportunity、隔离 Candidate、baseline/holdout/Retention、治理、future-Session 晋升或精确回滚流程。当前 Session 固定已选版本，候选不能修改评测治理面，证据不足会 `abstain` 或 `quarantine`。

这不是运行时从外部市场搜索、下载或导入 Skill 的功能，也不是模型自评。每个候选整包内容寻址，保留来源、版本、谱系、权限和证据；代码、凭据和外部副作用必须经过 Protected Action。当前能力和未完成的效果门见[实现状态](docs/status.zh.md)与[路线图](docs/roadmap.zh.md)。

## Web 控制面

`core` 和 `channels` 都提供同一个原生 DSH `conversation.view` 控制面，而不是多个悬浮网页：`core` 展示自我进化与诊断，`channels` 至少展示 Gateway/飞书/Telegram 渠道。它可以查看运行状态、能力/缺口、候选谱系与 diff、baseline/holdout、失败归因、成本/时延/cache、安全权限、晋升/隔离/回滚和渠道健康，并提供 pause/resume/approve/reject/promote/rollback。页面不调用模型；各插件通过同一 DSH child surface 接入。

## 开发、验证与发布

```sh
pnpm run check:docs
pnpm run check:ci
pnpm run check:suites
pnpm run typecheck
pnpm test
```

运行完整 `pnpm run check` 前，必须把 `DSH_EVOLVE_DSH_SOURCE_DIR` 指向干净的、与当前支持矩阵完全匹配的
DSH alpha.5 checkout；命令会在最开始校验 revision、版本和 tracked worktree，避免把 DSH 环境错配误报为
EvoForge 回归：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm run check
```

没有 DSH checkout 时仍可单独运行上面的文档、CI 路径和套件静态检查。当前支持边界与最新 DSH master 的
上游构建状态见[实现状态](docs/status.zh.md)，不要把未审计的 checkout 当作兼容目标。

开发只在 `main` 进行；通过的最小增量立即原子 commit 并推送 `origin/main`。Candidate 使用运行时内容寻址存储，不用 Git 分支。首个 annotated SemVer tag 只有在 clean-profile 安装/卸载、真实浏览器、真实渠道、真实 provider 和 Hermes paired 全部达到发布门后才能创建。门禁与证据索引见 [`release-gates.json`](release-gates.json) 和[发布纪律](docs/releasing.zh.md)。

## 设计与证据

- [能力套件和独立边界](docs/capability-suites.zh.md)
- [当前实现状态](docs/status.zh.md)
- [路线图](docs/roadmap.zh.md)
- [Hermes Gateway/配对调研](docs/research/hermes-gateway-pairing-current-2026-08-24.zh.md)
- [DSH alpha.5 迁移审计](docs/research/dsh-alpha5-migration-audit-2026-09-03.zh.md)
- [V5.69 alpha.5 迁移证据](docs/evidence/v5-69-dsh-alpha5-migration-2026-09-03.zh.md)

欢迎通过 Issue 或 Pull Request 提交可复现的 DSH revision、测试结果和用户体验反馈。请不要在 Issue 中提交飞书 App Secret、访问令牌或真实消息内容。
