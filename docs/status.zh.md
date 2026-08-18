# 当前实现状态

> 更新日期：2026-08-18。本文只描述当前权威 `main` 工作树，不把计划或历史分支当作已交付能力。

## 状态词

| 状态 | 含义 |
|---|---|
| `planned` | 尚无可运行实现 |
| `implemented` | 源码和自动化测试存在，真实环境或发布证据仍不足 |
| `verified` | 对应退出门有可复核的真实证据 |
| `released` | 已发布并验证安装、升级和卸载 |

## 当前总判断

EvoForge 已有大量 `implemented` 能力，但 v0.1 **未完成**。所有最新能力都在权威 `main`；十一个用户包都已收敛为无产品 bin 的 DSH Bundle，并通过同一次 clean-profile add/dump/boot/remove/readback。Workspace Channel Router、Telegram 与飞书第二 Adapter 已通过同 Host 双 Workspace 重启隔离；Workspace-owned Evolution 及其 Telegram/飞书 attention 已通过真实双 Workspace Host 路径。最新自主能力纵切已让模型在自然语言 active Goal 内、检查完整原生 Skill catalog 后，用一个稳定 Tool 声明可复核 Capability Gap，Host 先持久化再唤醒发现；本地 Git exact-first 确定性语义搜索、Agent Skills Discovery v0.2 单文件与 `.tar.gz`/`.zip` 整包制品、whole-Skill admission/Shadow、跨 Goal 需求聚类，以及 exact target + 日预算 + 原生 Jobs 驱动的 instruction-only 隔离 Candidate 生成已接通，详见 [V4-1](evidence/v4-1-autonomous-capability-gap.zh.md) 至 [V4-6](evidence/v4-6-cross-goal-skill-authoring.zh.md)。[完整 Cache Contract 门](evidence/kv-2-suite-composition-gate.zh.md)证明稳定 Gap Tool 在 64 轮内不漂移；真实浏览器控制面也已有复验。真实飞书 App 的身份请求、WebSocket 握手和 setup-only pairing transport 已通过。逐条退出门见 [v0.1 完成条件审计](evidence/v0.1-completion-audit.zh.md)；当前仍需用户发送配对短语完成 exact 飞书消息闭环，另缺官方/论文/开源检索、任意市场、整包组合、真实 provider/Hermes paired 证据及长期数据。

| 能力 | 当前状态 | 已有证据 | 仍缺 |
|---|---|---|---|
| 原生 DSH 插件产品形态 | `implemented` | 十一包均有 `name/inject/Config/apply`、Bundle patch、无 bin 合同；同一次 clean-profile tarball add/dump/boot/remove/readback 通过 | 陌生安装与 registry release 门禁 |
| Evidence-driven Evolution P0A–P1.21 + V4-1–V4-6 | `implemented` | paired Trial、Workspace-owned Generation/feedback/review/budget、Session pin、Retention、canary；自然 Goal→Host 复核/持久 Gap；local Git/Agent Skills v0.2 `skill-md`/archive 可信发现；whole-Skill admission/assembled Shadow；跨 Goal 聚类；无候选同名 cluster 经 exact 静态 target、持久日预算、原生 Jobs、崩溃状态机生成 instruction-only 隔离 Candidate，并在 Web 展示 phase/cost/provenance；64 轮稳定 Tool 与原生其余请求 parity | 官方资料/论文/开源搜索、ClawHub/任意市场、archive/多文件生成组合、真实 provider、路由质量及长期误晋升/回滚数据 |
| Software Delivery P2A–P2D | `implemented` | 真实 Git、原生 Tool/Goal、Draft PR、checks 与 Outcome；十一包 clean-profile 内从 packed Tool 完成原生 Goal | 真实长期任务 |
| GitHub Review Follow-up P3.2 | `implemented` | exact-head allowlist、bounded follow-up、重启去重、cache parity | 真实 reviewer 返修闭环和多日 resident |
| Web Control Plane | `verified` | packed artifact、真实 DSH Workspace/Host/Client Module；浏览器 pause→Host restart→persisted pause→resume/refresh；断线 fail visible 与恢复，console error 0 | 陌生用户可用性与长期数据 |
| Runtime Readiness | `implemented` | 原生 Loader/Command、tarball 生命周期 | v0.1 全包诊断和陌生安装数据 |
| Telegram 单私聊 | `implemented` | 已迁移 Channel Router；真实 DSH Workspace/Agent Loop、Commands、Approval、Goal/Schedule、durable ingress/delivery、cache parity、联合 tarball lifecycle | 真实 Bot 冒烟和多日证据 |
| Evolve Channel Attention | `implemented` | Telegram/飞书 actionable state、concrete routes、显式 Workspace、durable notice、request parity；进入十一包总装 | 真实渠道验证与多日移动端数据 |
| Goal Continuity | `implemented` | JSONL cold resume、SIGKILL、原生 Goal round limit | 多 Workspace 绑定、生产 soak |
| Resident OS unit | `implemented` | disabled Bundle、原生 `/resident`、exact hash/service-id 确认、无 bin tarball、十一包总装、launchd/systemd 与 macOS crash 测试 | Linux 真机和多日 soak |
| Workspace Channel Router | `implemented` | exact endpoint deny-by-default；原生 Workspace/Session/Agent create/resume；持久幂等/uncertain 状态机；Telegram/飞书同一真实 Host 的双 Workspace、Command、Approval、continuation 与重启去重隔离；十一包总装；真实飞书 App 握手 | exact 飞书 chat/user 消息闭环 |
| 飞书 Adapter | `implemented` | [AS-2](evidence/as-2-feishu-channel.zh.md)：官方 SDK WebSocket；exact allowlist；原生 Agent/Command/Approval/continuation；StorageDomain journal、429/uncertain、单渠道及双 Workspace 真实 Host、双 Agent完整 composition parity、tarball lifecycle；真实 App 身份请求、标准代理 WebSocket 与 setup-only pairing transport；同包原生 DSH Web 从最终 tarball 完成配对生成/复制/取消及 routes-mode 健康读取/刷新/Host 停机失败/同端口恢复，console error 0 | 用户发送一次配对短语后的 exact route 入站/回复/Approval 与多日重连 |
| Hermes paired benchmark | `implemented` | [EV-1](evidence/ev-1-hermes-paired-benchmark.zh.md)、[SD-1](evidence/sd-1-hermes-paired-benchmark.zh.md)、[LC-1](evidence/lc-1-hermes-paired-benchmark.zh.md) 与 [AS-1 approval](evidence/as-1-hermes-paired-benchmark.zh.md) 四个确定性 slice：前两项窄场景胜出；本机崩溃恢复与 Telegram 一次性审批均 0:0 平局 | 同模型真实编码、真实 Bot/App 消息交付、真实模型长任务、真实 provider 与长期 outcome 的 paired epochs |
| Registry release | `planned` | 无 | 全部门禁、版本矩阵、用户授权 |

## 当前可安装面

十一个包可生成 tarball 并通过 `dsh plugin --profile web add` 安装：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-goal-continuity`、`dsh-resident`、`dsh-channel-router`、`dsh-feishu`。外部路由、自动恢复和 OS 部署默认关闭。没有任何 EvoForge 独立 Runtime、网站、daemon 或产品 CLI 是受支持入口。

## 当前限制

- 固定 rc.5 源码是唯一支持证据；兼容范围不能由宽 peer range 推断；
- v0.1 浏览器复验已完成；真实 provider cache-read/TTFT 仍需有预算的 paired soak；
- 自主 Skill Discovery 当前支持显式授信本地 Git，以及 Agent Skills Discovery draft v0.2 的 `skill-md` 和 `.tar.gz`/`.zip` archive 同源、摘要先验、安全解包与隔离获取；跨 Goal cluster 本身只有证据权，但 exact 静态 target 已能有界调度 instruction-only Candidate 生成；ClawHub/任意市场、官方资料/论文/开源搜索、archive/多文件组合、真实 provider 和模型缺口质量仍缺失；
- 真实飞书 exact route 消息、真实 provider、陌生用户和生产多日证据仍缺失；本轮按项目所有者要求不验证 Telegram；
- 自动化 `implemented` 不能替代真实 outcome，也不能支持笼统的“优于 Hermes”；
- 不 merge、不发布 registry、不部署生产，除非用户另行授权。
