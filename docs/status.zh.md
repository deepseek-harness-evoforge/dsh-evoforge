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

EvoForge 已有大量 `implemented` 能力，但 v0.1 **未完成**。所有已提交成果都在权威 `main`；`dsh-gateway` 已直接替换 `dsh-channel-router`。ClawHub、市场和 runtime research Candidate 已删除；`dsh-evolve` 公开 Git repository/source、目标 Skill、静态 Case Pack、Feedback/Evaluator target 和按 Skill AutoPromotion 配置及活动装配也已删除。公开 Config 只包含内容寻址缓存、Workspace 自发现/评测 policy 和通用 supervisor；活动 `GenerationBundleRepository`/`CandidatePublisher` 又删除了 Git source、隐藏 ref 和 repository fallback，只解析内部 whole-Skill Bundle，legacy artifact 明确 quarantine；packed artifact 有负向回归契约。源码树仍有未装配的历史 target/Git 模块、`Shadow` 旧 proposer 和 Control 类型，尚待物理删除。

当前 Candidate seam 只接受内部 Skill Opportunity 生成的 canonical text bundle。两个独立 Goal 形成 Opportunity；至少四个 Goal 后才预密封 authoring/admission/holdout 证据，Candidate v2、Lineage v3 与 Envelope v4 绑定 exact seal。真实 assembled baseline 不安装目标 Skill，Candidate 侧才安装 exact whole-Skill；经复核的新 Skill 可形成内容寻址 inactive Generation，真实 DSH 已验证 future-Session-only、重启固定和 root rollback。原先静态 Retention/canary 编排不再由插件装配，必须重新绑定内部 Opportunity/Candidate 证据后才能算活动能力。

Gateway 已统一 Telegram/飞书普通文本 outbound、幂等、限流、uncertain 恢复、transport observation 和健康快照；Web 已做真实浏览器读取/刷新/断连恢复。现有 Skill 的同版本跨 Goal 精确纠正只形成等待完整 baseline Bundle 的 investigation。existing-Skill Candidate、完整返工/成本/复用/Retention/负迁移/回滚归因、真实飞书 exact 消息、真实 provider、Hermes paired 和长期数据仍未达标。

V4.19 贯穿红测发现 V4.18 把治理生成的 admission/holdout 都标成 assembled，导致确定性 Admission 固定返回 `assembled-evaluator-not-governance-separated`；现已按 [ADR-0063](adr/0063-governance-splits-deterministic-admission-from-assembled-holdout.md) 修成“不执行 Candidate 的 deterministic admission → 独立 assembled holdout”。治理 budget deny 持久化为 `budget-deferred`，作者调用异常后立即持久化 `uncertain`；Host/Web 只读展示 phase、0–2 次调用、token、retry 与脱敏失败分类，仍不暴露 protected Goal、evaluator、provider identity 或路径。详见 [V4.19 证据](evidence/v4-19-governance-admission-handoff.zh.md)。本机没有两套独立真实 provider 配置，因此状态仍是 `implemented`，不能升级为真实 provider `verified`。

V4.20 按 [ADR-0064](adr/0064-corrections-require-exact-durable-skill-invocation.md) 删除 correction 的 same-Session/unique-Gap 猜测：Host 从 feedback 目标回答的 durable turn 解析唯一成功 Skill invocation 和 exact Goal id/revision，歧义即 abstain；Signal 跨 Storage restart 保留有界身份，Web 分开展示 exact correction attribution 与非因果 Delivery Outcome association。详见 [V4.20 证据](evidence/v4-20-exact-durable-feedback-attribution.zh.md)。该增量没有把 correction 扩权为 Opportunity 资格或 Candidate，也没有完成 existing-Skill 再进化。

V4.21 按 [ADR-0065](adr/0065-existing-skill-improvement-requires-exact-invocation-content.md) 给 exact correction attribution 增加 durable invocation-content hash；同名内容漂移会分流，legacy 无 hash 只读。只有同 Workspace/Skill/hash 在至少两个不同 Goal 的去重纠正才形成独立 `waiting-for-baseline-bundle` 调查，Web 明示 exact version、无因果和 Candidate 阻断。详见 [V4.21 证据](evidence/v4-21-existing-skill-improvement-investigation.zh.md)。完整 Bundle baseline、skill-tree Envelope、Candidate 与晋升仍未实现。

| 能力 | 当前状态 | 已有证据 | 仍缺 |
|---|---|---|---|
| 原生 DSH 插件产品形态 | `implemented` | 十一包均有 `name/inject/Config/apply`、Bundle patch、无 bin 合同；同一次 clean-profile tarball add/dump/boot/remove/readback 通过 | 陌生安装与 registry release 门禁 |
| Evidence-driven Evolution + internal Skill Opportunity | `implemented` | 自然 Goal→Host 复核/持久 Gap；跨 Goal Opportunity；预密封 authoring/admission/holdout；Candidate v2/Lineage v3/Envelope v4；capability-absent assembled evaluation；内容寻址 Generation、future Session pin、restart 与 rollback；[V4.22](evidence/v4-22-runtime-source-target-removal.zh.md) 删除公开配置，[V4.23](evidence/v4-23-content-addressed-generation-runtime.zh.md) 删除活动 Git source/ref/repository fallback 并 quarantine legacy | 未装配历史模块/Shadow 旧 proposer/Control 类型继续清理；existing-Skill 完整 baseline Bundle/Candidate、内部 Retention/canary 重接、真实 provider、长期误晋升/回滚数据缺失 |
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

最新 V4.23 增量通过根级 `pnpm check`（文档、全包 typecheck、测试和构建）；其中
`dsh-gateway` 7 files/23 tests、`dsh-evolve-web` 2 files/26 tests，`dsh-evolve` 65 files、279 tests passed、
2 skipped。Cache Contract 全通过；Doctor 十一包原生合同 22/22，十一包 clean-profile 最终 tarball 的
add/dump/boot/真实 Session+Goal+Storage+Tool/dispose/remove/reboot/readback 1/1（31.32 秒）；独立 Doctor
packed add/Loader/command/remove 1/1（4.07 秒）。V4.23 没有新增浏览器功能；此前真实浏览器显示 exact
existing-Skill version 调查、跨 Goal 证据、无因果与等待完整 Bundle，刷新后保持，diagnostics 为 `[]`。

十一个包可生成 tarball 并通过 `dsh plugin --profile web add` 安装：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-goal-continuity`、`dsh-resident`、`dsh-gateway`、`dsh-feishu`。外部路由、自动恢复和 OS 部署默认关闭。没有任何 EvoForge 独立 Runtime、网站、daemon 或产品 CLI 是受支持入口。

## 当前限制

- 固定 rc.5 源码是唯一支持证据；兼容范围不能由宽 peer range 推断；
- v0.1 浏览器复验已完成；真实 provider cache-read/TTFT 仍需有预算的 paired soak；
- 自我发现只允许从 DSH 内部 Goal、Gap、失败、纠正、结果、复用与保留证据学习；同 Goal retry 不计独立证据，任何 Opportunity/Candidate 自身都没有安装、激活或发布权；配置已不能预选内部 Candidate Skill，作者与 admission/holdout 样本已在调用前隔离，Candidate v2/Lineage v3/Envelope v4 显式绑定 seal，Candidate-independent 治理包形成与 uncertain crash 门已实现，缺失 Skill baseline 不再伪造占位 Skill，review 后的新 Skill Publisher/future Session/root rollback/absent-parent Retention/canary 已实现，但当前仍缺治理包真实 provider assembled 独立评估整链 outcome、长期负迁移率和模型缺口质量；
- Hermes/OpenClaw/HanaAgent、论文、市场和开源实现只用于设计期调研与冻结 benchmark；运行时外部 Skill 搜索、获取、下载、导入或市场功能不属于本项目；
- 真实飞书 exact route 消息、真实 Telegram/飞书 paired、真实 provider、陌生用户和生产多日证据仍缺失；
- 自动化 `implemented` 不能替代真实 outcome，也不能支持笼统的“优于 Hermes”；
- 不 merge、不发布 registry、不部署生产，除非用户另行授权。
