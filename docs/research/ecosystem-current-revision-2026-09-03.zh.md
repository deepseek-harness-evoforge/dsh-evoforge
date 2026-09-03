# Hermes、OpenClaw、HanaAgent 当前 revision 复核（2026-09-03）

## 目的与边界

本页只固定设计期参考项目的当前公开 revision，供 Hermes paired benchmark 和架构复核使用；它们不进入
EvoForge 运行时，不提供 Skill 下载、市场搜索或第二套 Agent/Gateway。历史调研页保留其当日事实，不被本页
追溯改写。

## 远端事实

以下值由 2026-09-03 通过各项目公开 GitHub API `commits?per_page=1` 读取；tag 由公开 refs 读取。只记录
commit、tag 和 URL，不保存凭据或私有内容。

| 项目 | 当前远端 `HEAD` | 最近已知公开 tag | 说明 |
|---|---|---|---|
| Hermes Agent | [`63279301bcbdc185c1b07b98a9312eb0c862f26d`](https://github.com/NousResearch/hermes-agent/commit/63279301bcbdc185c1b07b98a9312eb0c862f26d) | [`v2026.8.19`](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.19) → `b05e680e63d39d5a8e3ec0f5842a41d1c4209c03` | 本地 checkout 仍停在旧 commit，不能代替当前远端；paired 前必须用该 HEAD 或明确锁定的 tag。 |
| OpenClaw | [`1fb3e0ca33847b5827a21cf5cb132d3f90ff49ad`](https://github.com/openclaw/openclaw/commit/1fb3e0ca33847b5827a21cf5cb132d3f90ff49ad) | 本轮不宣称未经核对的 release tag | 仅作 self-learning、插件控制面和渠道边界的设计参照。 |
| HanaAgent / openhanako | [`1d3ef308299e9f630786384e77de45444ea59196`](https://github.com/liliMozi/openhanako/commit/1d3ef308299e9f630786384e77de45444ea59196) | [`v0.450.0`](https://github.com/liliMozi/openhanako/releases/tag/v0.450.0) → `de7076cf7d594b5fd7723c34752ffaa2ac0e0e6f` | 当前 HEAD 与 tag 已分开记录；不把桌面端 Page/Widget 机制移植成 DSH 第二路由。 |

## 对当前目标的影响

1. Hermes 的常驻 Gateway、Host 配对和断线恢复继续作为行为参照；EvoForge 必须在 DSH 原生 Host、Session、
   Goal、Jobs 和权限边界内实现，不能复制 Hermes 的第二 Runtime。
2. OpenClaw 的 self-learning reviewer、候选隔离、hook 和控制面只用于检查 EvoForge 的 proposer/evaluator/
   mutation 分离；EvoForge 仍只从 DSH 内部 Goal/反馈/失败/纠正形成 Gap，禁止运行时外部 Skill 获取。
3. Hana 的中央 Page、Widget、插件权限隔离用于审美和信息层级参照；DSH 侧仍只使用一个原生
   `conversation.view` 和 child surface slot，不打开多个网页或固定遮挡弹窗。

## 复核纪律

- 每次 Hermes paired 或参考行为变更前重新读取远端 HEAD，记录日期、commit、tag 和源码入口；不能只依赖本页。
- 若远端项目发生重写或 tag 漂移，保留旧 evidence，并新建日期化复核，不覆盖历史 benchmark 结果。
- 参考实现不能成为 EvoForge 的运行时依赖、外部市场、Provider 路由、Skill 导入入口或发布门捷径。
