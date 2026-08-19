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

EvoForge 已有大量 `implemented` 能力，但 v0.1 **未完成**。所有已提交成果都在权威 `main`；`dsh-gateway` 已直接替换 `dsh-channel-router`，不保留兼容转发包。旧能力获取/运行时 research Candidate 的活动源码、依赖、持久化变体和 Web 投影已删除，构建还会清理这些已删除模块遗留的孤儿声明，避免旧 acquisition API 继续出现在 tarball。当前 Candidate seam 只接受内部 Skill Opportunity 生成的 canonical text bundle。内部 Candidate 的两套配置式 Skill targets 也已删除：Workspace policy 只给治理根/运行根。两个独立 Goal 仍形成 Opportunity；至少四个 Goal 后，`SkillEvaluationEvidenceVault` 才在作者调用前内容寻址密封 authoring/admission/holdout，作者只收到前者，样本不足不花预算、不生成 Candidate。Host 在 seal 尚未落盘时准确投影 `ready-to-seal`，落盘且复核一致后才投影 `sealed`；凡参与 Opportunity 的 Gap，Web 投影保守移除 Goal objective。Opportunity-bound Envelope v3 重新绑定 seal 与 author-input digest，并使用不含 `SKILL.md` 的 capability-absent descriptor；真实 assembled baseline 不安装目标 Skill，Candidate 侧才安装 exact whole-Skill，身份贯穿 Admission、Lineage、Shadow、Review 与 crash resume。经复核的新 Skill 可形成不依赖 Git source 的内容寻址 inactive `skill-bundle` Generation；真实 DSH Agent 已验证晋升只影响未来 Session、root rollback 恢复后续 native Session、旧 Session 与重启恢复均保持 exact bundle。独立 Retention 与 sealed canary 现可使用原 Shadow 的 exact absent subject 和 exact whole-Skill Candidate，在无 Git source 情况下完成真实 assembled DSH paired replay；污染 subject、Candidate 篡改、lineage/parent 身份错配均 fail closed。从密封样本自主生成并校准 Case Pack 仍未实现，自动 clear-win policy 也没有扩权到全新 Skill。Gateway 现已统一 Telegram/飞书普通文本 outbound intent/journal、幂等、按 account 串行、明确限流重试、turn/end 门、uncertain 恢复、脱敏 transport observation 和健康快照，两个 Adapter 的重复 Delivery Store/worker 已删除；同包官方 DSH Client Module 的统一只读健康视图已从最终 tarball 在真实浏览器验证读取、刷新、Host 停机清除旧快照和同端口恢复。当前 Opportunity 资格仍只来自重复 Goal-linked Gap，并已保守关联同 Session 的明确纠正引用，以及同一稳定 Goal id 下不早于 Gap、revision 不倒退的真实交付结果；这些上下文固定无因果、无资格影响。私有 Feedback Draft 的逐条复制仍需用户授权，但命令已不再接受目标 Skill，Builder 必须从 durable Session 的唯一真实 `skill-invocation` 自主推导并核对 pinned Generation；这尚未打通 correction 到 Opportunity 的因果资格。Delivery Outcome 已可附带 exact Goal-owned turn 的官方 token/cache/latency facts，Host 权威聚合和有界最近证据也已进入 DSH Web，并通过真实 Host 的刷新、断连、同 profile 重启恢复与幂等重放；但货币成本、返工、复用、长期 Retention/负迁移和回滚完整归因仍缺。真实飞书 exact 消息、真实 provider、Hermes paired 和长期数据均未达标。

| 能力 | 当前状态 | 已有证据 | 仍缺 |
|---|---|---|---|
| 原生 DSH 插件产品形态 | `implemented` | 十一包均有 `name/inject/Config/apply`、Bundle patch、无 bin 合同；同一次 clean-profile tarball add/dump/boot/remove/readback 通过 | 陌生安装与 registry release 门禁 |
| Evidence-driven Evolution P0A–P1.21 + internal Skill Opportunity | `implemented` | paired Trial、Workspace-owned Generation/feedback/review/budget、Session pin、Retention、canary；自然 Goal→Host 复核/持久 Gap；至少两个独立 Goal 形成 Skill Opportunity，至少四个后预密封 proposer-visible/admission/holdout；Web 显示 readiness 与保护边界；[V4.11](evidence/v4-11-durable-feedback-skill-attribution.zh.md) private Feedback Draft 不接受用户选择 Skill，而从 durable turn 的唯一 invocation 推导并核对 pinned Generation；同 Session 唯一 Skill 纠正和 stable Goal identity 跨 revision、时间/revision 单调的唯一 Skill Outcome 作为 `causalClaim: none` 上下文并可跨 Storage restart 恢复；Outcome 可选保存 exact Goal turn 的官方 token/cache/latency projection；Workspace-only author/evaluation policies 均无 Skill 预配置；内部证据 author→canonical whole-Skill v1 quarantine；Envelope v3 绑定 evidence seal/author input 并贯穿 admission/holdout/Lineage；[V4.14](evidence/v4-14-capability-absent-baseline.zh.md) 以无目标 Skill 的真实 assembled DSH baseline 对比 exact Candidate；[V4.15](evidence/v4-15-content-addressed-new-skill-generation.zh.md) 不依赖 Git source 发布 inactive bundle；[V4.16](evidence/v4-16-capability-absent-retention-canary.zh.md) 对 exact absent parent/whole-Skill 做无 Git paired replay；64 轮稳定 Tool 与原生其余请求 parity | correction/outcome 到 Opportunity 的 exact invocation 因果链接，以及 rework/currency-cost/reuse/retention/negative-transfer/rollback 完整归因；密封样本尚不能自主形成/校准 Case Pack，existing bundle 再进化、真实 provider 整链、路由质量及长期误晋升/回滚数据缺失 |
| Software Delivery P2A–P2D | `implemented` | 真实 Git、原生 Tool/Goal、Draft PR、checks；Outcome 只从 source-linked Session call/result pair 读取，经官方 durability checkpoint 后投影，并可在 cold Session start 幂等补记；十一包 clean-profile 内从 packed Tool 完成原生 Goal | 真实长期任务与 checkpoint 前 hard kill、checkpoint 后投影前 kill 的跨进程故障注入 |
| GitHub Review Follow-up P3.2 | `implemented` | exact-head allowlist、bounded follow-up、重启去重、cache parity | 真实 reviewer 返修闭环和多日 resident |
| Web Control Plane | `verified` | packed artifact、真实 DSH Workspace/Host/Client Module；浏览器 pause→Host restart→persisted pause→resume/refresh；Goal metrics 的 Workspace/current/baseline 聚合和最近证据来自 Host 权威 Remote；最终 tarball clean-profile 中以四个原生 DSH Session/Goal 形成 Opportunity，显示 `ready-to-seal`、2/1/1 分割、目标正文保护和零 Candidate；在线刷新、断线保留最后快照并 fail visible、同 profile 恢复、Outcome 幂等 1→1，console error 0 | 陌生用户可用性、真实 provider 价格与长期数据 |
| Runtime Readiness | `implemented` | 原生 Loader/Command、tarball 生命周期 | v0.1 全包诊断和陌生安装数据 |
| Telegram 单私聊 | `implemented` | 已迁移 DSH Gateway；真实 DSH Workspace/Agent Loop、Commands、Approval、Goal/Schedule、Gateway durable ingress/outbound、cache parity、联合 tarball lifecycle；私有 Delivery Store 已删除；真实 assembled long-poll failure→Gateway `degraded`→成功 poll→`ready` | 真实 Bot 冒烟和多日证据 |
| Evolve Channel Attention | `implemented` | Telegram/飞书 actionable state、concrete routes、显式 Workspace、durable notice、request parity；进入十一包总装 | 真实渠道验证与多日移动端数据 |
| Goal Continuity | `implemented` | JSONL cold resume、SIGKILL、原生 Goal round limit | 多 Workspace 绑定、生产 soak |
| Resident OS unit | `implemented` | disabled Bundle、原生 `/resident`、exact hash/service-id 确认、无 bin tarball、十一包总装、launchd/systemd 与 macOS crash 测试 | Linux 真机和多日 soak |
| Workspace DSH Gateway | `implemented` | `dsh-gateway` 直接替换旧包且无兼容层；exact endpoint/Adapter account/routeIds deny-by-default；原生 Workspace/Session/Agent create/resume；持久 ingress/outbound 幂等与 uncertain 状态机；按 account 串行、明确限流重试、turn/end 门、重启后原生 turn/end 唤醒、畸形 success 保守降级；[V5.1](evidence/v5-1-gateway-transport-health.zh.md) 聚合 Telegram/飞书脱敏 transport observation；[V5.2](evidence/v5-2-gateway-web-health.zh.md) 以同包只读 Remote/Client 在真实 DSH 浏览器验证读取、刷新、失败清空旧快照与恢复 | exact 飞书 chat/user 消息闭环、真实渠道长期运行与 paired benchmark |
| 飞书 Adapter | `implemented` | [AS-2](evidence/as-2-feishu-channel.zh.md)：官方 SDK WebSocket；exact allowlist；原生 Agent/Command/Approval/continuation；Gateway outbound journal、429/uncertain、单渠道及双 Workspace 真实 Host、双 Agent完整 composition parity、tarball lifecycle；私有 Delivery Store/worker 已删除；真实 App 身份请求、标准代理 WebSocket 与 setup-only pairing transport；同包原生 DSH Web 从最终 tarball完成配对生成/复制/取消及 routes-mode Gateway 权威 transport/outbound 健康读取/刷新/Host 停机失败/同端口恢复，console error 0；assembled transport error→`degraded`→message→`ready` | 用户发送一次配对短语后的 exact route 入站/回复/Approval 与多日重连 |
| Hermes paired benchmark | `implemented` | [EV-1](evidence/ev-1-hermes-paired-benchmark.zh.md)、[SD-1](evidence/sd-1-hermes-paired-benchmark.zh.md)、[LC-1](evidence/lc-1-hermes-paired-benchmark.zh.md) 与 [AS-1 approval](evidence/as-1-hermes-paired-benchmark.zh.md) 四个确定性 slice：前两项窄场景胜出；本机崩溃恢复与 Telegram 一次性审批均 0:0 平局 | 同模型真实编码、真实 Bot/App 消息交付、真实模型长任务、真实 provider 与长期 outcome 的 paired epochs |
| Registry release | `planned` | 无 | 全部门禁、版本矩阵、用户授权 |

## 当前可安装面

最新 V4-17 增量通过根级 `pnpm check`；其中 `dsh-gateway` 7 files/23 tests、
`dsh-telegram` 7 files/26 tests、`dsh-feishu` 13 files/31 tests，`dsh-evolve` 60 files passed、
1 file skipped，290 tests passed、2 skipped。Cache Contract 全通过，Doctor 原生合同 22/22；十一包
clean-profile tarball add/dump/boot/真实 Session+Goal+Tool/dispose/remove/reboot/readback 1/1（29.78 秒），
独立 Doctor packed add/Loader/command/remove 生命周期 1/1（4.08 秒）。

十一个包可生成 tarball 并通过 `dsh plugin --profile web add` 安装：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-goal-continuity`、`dsh-resident`、`dsh-gateway`、`dsh-feishu`。外部路由、自动恢复和 OS 部署默认关闭。没有任何 EvoForge 独立 Runtime、网站、daemon 或产品 CLI 是受支持入口。

## 当前限制

- 固定 rc.5 源码是唯一支持证据；兼容范围不能由宽 peer range 推断；
- v0.1 浏览器复验已完成；真实 provider cache-read/TTFT 仍需有预算的 paired soak；
- 自我发现只允许从 DSH 内部 Goal、Gap、失败、纠正、结果、复用与保留证据学习；同 Goal retry 不计独立证据，任何 Opportunity/Candidate 自身都没有安装、激活或发布权；配置已不能预选内部 Candidate Skill，作者与 admission/holdout 样本已在调用前隔离，缺失 Skill baseline 不再伪造占位 Skill，review 后的新 Skill Publisher/future Session/root rollback/absent-parent Retention/canary 已实现，但当前仍缺密封样本到 Case Pack/Envelope 的自主形成与校准、真实 provider 独立评估整链 outcome、长期负迁移率和模型缺口质量；
- Hermes/OpenClaw/HanaAgent、论文、市场和开源实现只用于设计期调研与冻结 benchmark；运行时外部 Skill 搜索、获取、下载、导入或市场功能不属于本项目；
- 真实飞书 exact route 消息、真实 Telegram/飞书 paired、真实 provider、陌生用户和生产多日证据仍缺失；
- 自动化 `implemented` 不能替代真实 outcome，也不能支持笼统的“优于 Hermes”；
- 不 merge、不发布 registry、不部署生产，除非用户另行授权。
