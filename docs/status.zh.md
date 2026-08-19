# 当前实现状态

> 更新日期：2026-08-19。本文只描述当前权威 `main` 工作树，不把计划或历史分支当作已交付能力。

## 状态词

| 状态 | 含义 |
|---|---|
| `planned` | 尚无可运行实现 |
| `implemented` | 源码和自动化测试存在，真实环境或发布证据仍不足 |
| `verified` | 对应退出门有可复核的真实证据 |
| `released` | 已发布并验证安装、升级和卸载 |

## 当前总判断

EvoForge 已有大量 `implemented` 能力，但 v0.1 **未完成**。所有已提交成果都在权威 `main`；`dsh-gateway` 已直接替换 `dsh-channel-router`，不保留兼容转发包。旧能力获取/运行时 research Candidate 的活动源码、依赖、持久化变体和 Web 投影已删除，当前 Candidate seam 只接受内部 Skill Opportunity 生成的 canonical text bundle。内部 Candidate 的两套配置式 Skill targets 也已删除：Workspace policy 只给治理根/运行根，同一 Opportunity-bound Evaluation Envelope 绑定 baseline、deterministic admission 和独立 assembled holdout，并以内容身份贯穿 Lineage/Shadow；治理包尚不能从内部证据自主形成。Gateway 现已统一 Telegram/飞书普通文本 outbound intent/journal、幂等、按 account 串行、明确限流重试、turn/end 门、uncertain 恢复和脱敏健康，两个 Adapter 的重复 Delivery Store/worker 已删除；平台 transport 健康聚合和统一 Web 展示尚未收敛。当前 Opportunity 资格仍只来自重复 Goal-linked Gap，并已保守关联同 Session 的明确纠正引用，以及同一稳定 Goal id 下不早于 Gap、revision 不倒退的真实交付结果；这些上下文固定无因果、无资格影响。私有 Feedback Draft 的逐条复制仍需用户授权，但命令已不再接受目标 Skill，Builder 必须从 durable Session 的唯一真实 `skill-invocation` 自主推导并核对 pinned Generation；这尚未打通 correction 到 Opportunity 的因果资格。Delivery Outcome 已可附带 exact Goal-owned turn 的官方 token/cache/latency facts，Host 权威聚合和有界最近证据也已进入 DSH Web，并通过真实 Host 的刷新、断连、同 profile 重启恢复与幂等重放；但货币成本、返工、复用、Retention、负迁移和回滚完整归因仍缺。真实飞书 exact 消息、内部 Candidate 真实独立评测整链、真实 provider、Hermes paired 和长期数据均未达标。

| 能力 | 当前状态 | 已有证据 | 仍缺 |
|---|---|---|---|
| 原生 DSH 插件产品形态 | `implemented` | 十一包均有 `name/inject/Config/apply`、Bundle patch、无 bin 合同；同一次 clean-profile tarball add/dump/boot/remove/readback 通过 | 陌生安装与 registry release 门禁 |
| Evidence-driven Evolution P0A–P1.21 + internal Skill Opportunity | `implemented` | paired Trial、Workspace-owned Generation/feedback/review/budget、Session pin、Retention、canary；自然 Goal→Host 复核/持久 Gap；至少两个独立 Goal 形成 Skill Opportunity；[V4.11](evidence/v4-11-durable-feedback-skill-attribution.zh.md) private Feedback Draft 不接受用户选择 Skill，而从 durable turn 的唯一 invocation 推导并核对 pinned Generation；同 Session 唯一 Skill 纠正和 stable Goal identity 跨 revision、时间/revision 单调的唯一 Skill Outcome 作为 `causalClaim: none` 上下文并可跨 Storage restart 恢复；Outcome 可选保存 exact Goal turn 的官方 token/cache/latency projection；Host 权威 rollup/最近证据经 Remote 进入 Web，真实浏览器验证刷新/断连/恢复且重放不重复；Workspace-only author/evaluation policies 均无 Skill 预配置；内部证据 author→canonical whole-Skill v1 quarantine；[V4.13](evidence/v4-13-opportunity-bound-evaluation-envelope.zh.md) 同一 Opportunity-bound Envelope 贯穿 admission/assembled holdout/Lineage，漂移与路径攻击 fail closed；64 轮稳定 Tool 与原生其余请求 parity | correction/outcome 到 Opportunity 的 exact invocation 因果链接，以及 rework/currency-cost/reuse/retention/negative-transfer/rollback 完整归因；Evaluation Envelope 尚不能从内部证据自主生成，且缺 final-test/Shadow/Retention 真实 provider 整链路、路由质量及长期误晋升/回滚数据 |
| Software Delivery P2A–P2D | `implemented` | 真实 Git、原生 Tool/Goal、Draft PR、checks；Outcome 只从 source-linked Session call/result pair 读取，经官方 durability checkpoint 后投影，并可在 cold Session start 幂等补记；十一包 clean-profile 内从 packed Tool 完成原生 Goal | 真实长期任务与 checkpoint 前 hard kill、checkpoint 后投影前 kill 的跨进程故障注入 |
| GitHub Review Follow-up P3.2 | `implemented` | exact-head allowlist、bounded follow-up、重启去重、cache parity | 真实 reviewer 返修闭环和多日 resident |
| Web Control Plane | `verified` | packed artifact、真实 DSH Workspace/Host/Client Module；浏览器 pause→Host restart→persisted pause→resume/refresh；Goal metrics 的 Workspace/current/baseline 聚合和最近证据来自 Host 权威 Remote；在线刷新、断线保留最后快照并 fail visible、同 profile 恢复、Outcome 幂等 1→1，console error 0 | 陌生用户可用性、真实 provider 价格与长期数据 |
| Runtime Readiness | `implemented` | 原生 Loader/Command、tarball 生命周期 | v0.1 全包诊断和陌生安装数据 |
| Telegram 单私聊 | `implemented` | 已迁移 DSH Gateway；真实 DSH Workspace/Agent Loop、Commands、Approval、Goal/Schedule、Gateway durable ingress/outbound、cache parity、联合 tarball lifecycle；私有 Delivery Store 已删除 | 真实 Bot 冒烟和多日证据 |
| Evolve Channel Attention | `implemented` | Telegram/飞书 actionable state、concrete routes、显式 Workspace、durable notice、request parity；进入十一包总装 | 真实渠道验证与多日移动端数据 |
| Goal Continuity | `implemented` | JSONL cold resume、SIGKILL、原生 Goal round limit | 多 Workspace 绑定、生产 soak |
| Resident OS unit | `implemented` | disabled Bundle、原生 `/resident`、exact hash/service-id 确认、无 bin tarball、十一包总装、launchd/systemd 与 macOS crash 测试 | Linux 真机和多日 soak |
| Workspace DSH Gateway | `implemented` | `dsh-gateway` 直接替换旧包且无兼容层；exact endpoint/Adapter account/routeIds deny-by-default；原生 Workspace/Session/Agent create/resume；持久 ingress/outbound 幂等与 uncertain 状态机；按 account 串行、明确限流重试、turn/end 门、重启后原生 turn/end 唤醒、畸形 success 保守降级、脱敏健康；Gateway 17、Telegram 26、飞书 31 项回归，全仓 `pnpm check`、Cache Contract、Doctor 22/22 和十一包 clean-profile 均通过，两个 Adapter 私有 Delivery Store 已删除 | transport 健康聚合、统一 Web 展示、exact 飞书 chat/user 消息闭环 |
| 飞书 Adapter | `implemented` | [AS-2](evidence/as-2-feishu-channel.zh.md)：官方 SDK WebSocket；exact allowlist；原生 Agent/Command/Approval/continuation；Gateway outbound journal、429/uncertain、单渠道及双 Workspace 真实 Host、双 Agent完整 composition parity、tarball lifecycle；私有 Delivery Store/worker 已删除；真实 App 身份请求、标准代理 WebSocket 与 setup-only pairing transport；同包原生 DSH Web 从最终 tarball完成配对生成/复制/取消及 routes-mode 健康读取/刷新/Host 停机失败/同端口恢复，console error 0 | 用户发送一次配对短语后的 exact route 入站/回复/Approval 与多日重连 |
| Hermes paired benchmark | `implemented` | [EV-1](evidence/ev-1-hermes-paired-benchmark.zh.md)、[SD-1](evidence/sd-1-hermes-paired-benchmark.zh.md)、[LC-1](evidence/lc-1-hermes-paired-benchmark.zh.md) 与 [AS-1 approval](evidence/as-1-hermes-paired-benchmark.zh.md) 四个确定性 slice：前两项窄场景胜出；本机崩溃恢复与 Telegram 一次性审批均 0:0 平局 | 同模型真实编码、真实 Bot/App 消息交付、真实模型长任务、真实 provider 与长期 outcome 的 paired epochs |
| Registry release | `planned` | 无 | 全部门禁、版本矩阵、用户授权 |

## 当前可安装面

十一个包可生成 tarball 并通过 `dsh plugin --profile web add` 安装：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-goal-continuity`、`dsh-resident`、`dsh-gateway`、`dsh-feishu`。外部路由、自动恢复和 OS 部署默认关闭。没有任何 EvoForge 独立 Runtime、网站、daemon 或产品 CLI 是受支持入口。

## 当前限制

- 固定 rc.5 源码是唯一支持证据；兼容范围不能由宽 peer range 推断；
- v0.1 浏览器复验已完成；真实 provider cache-read/TTFT 仍需有预算的 paired soak；
- 自我发现只允许从 DSH 内部 Goal、Gap、失败、纠正、结果、复用与保留证据学习；同 Goal retry 不计独立证据，任何 Opportunity/Candidate 都没有安装、激活或发布权；配置已不能预选内部 Candidate Skill，但当前仍缺治理包自主形成、真实 provider 独立评估整链 outcome 和模型缺口质量；
- Hermes/OpenClaw/HanaAgent、论文、市场和开源实现只用于设计期调研与冻结 benchmark；运行时外部 Skill 搜索、获取、下载、导入或市场功能不属于本项目；
- 真实飞书 exact route 消息、真实 Telegram/飞书 paired、真实 provider、陌生用户和生产多日证据仍缺失；
- 自动化 `implemented` 不能替代真实 outcome，也不能支持笼统的“优于 Hermes”；
- 不 merge、不发布 registry、不部署生产，除非用户另行授权。
