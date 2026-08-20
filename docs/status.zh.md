# 当前实现状态

> 更新日期：2026-08-20。本文只描述当前权威 `main` 工作树，不把计划或历史分支当作已交付能力。

## 状态词

| 状态 | 含义 |
|---|---|
| `planned` | 尚无可运行实现 |
| `implemented` | 源码和自动化测试存在，真实环境或发布证据仍不足 |
| `verified` | 对应退出门有可复核的真实证据 |
| `released` | 已发布并验证安装、升级和卸载 |

## 当前总判断

EvoForge 已有大量 `implemented` 能力，但 v0.1 **未完成**。所有已提交成果都在权威 `main`；`dsh-gateway` 已直接替换 `dsh-channel-router`。ClawHub、市场和 runtime research Candidate 已删除；`dsh-evolve` 的 Git source/ref、预选 Skill、静态 Case Pack/Feedback/Evaluator target、Feedback/Evaluator Draft、Shadow 内 proposer、自动 review expiry、旧 Retention/canary 和对应 Control/Web/attention 表面也已从活动源码物理删除。公开 Config 只包含内容寻址缓存、Workspace 自发现/评测 policy 和通用 supervisor；`GenerationBundleRepository`/`CandidatePublisher` 只解析内部 whole-Skill Bundle，legacy artifact 明确 quarantine；packed artifact 与 Shadow 源码均有负向回归契约。Gateway 的入站边界现支持文本和 DSH 原生图片引用；飞书外部图片 key 在 Adapter 内下载并经 AttachmentStore 内容寻址保存，不进入 Session。固定 DSH attachment v1 不支持通用文件，普通文件/音视频仍明确 pending。

当前 Candidate seam 只接受内部 Skill Opportunity 生成的 canonical text bundle。两个独立 Goal 形成 Opportunity；四个 Goal 预密封 authoring/admission/holdout，存在第五个或更多独立 Goal 时再保留一个 Candidate 不可见的 Retention 样本。Candidate v2、Lineage v3 与 exact seal 绑定；四 Goal路径保持 Envelope v4 并对 Retention abstain，带第五 Goal 时形成 Envelope v5，绑定独立 assembled Retention Case Pack 与 run root。真实 assembled baseline 不安装目标 Skill，Candidate 侧才安装 exact whole-Skill；Shadow 只消费同一 exact Candidate、内容哈希、tree、lineage 与 `dshAssembled` Trial，自身不调用 proposer。promotable Shadow 现会在同一个 DSH Jobs 任务内进入内容寻址 Retention paired Trial，持久写入 retained/regressed/incomplete，结果无发布权。Host/Web 已按 exact Workspace/Skill/Candidate/Admission/Envelope/Shadow/tree 谱系投影真实 Shadow 与 Retention verdict，错配或篡改只告警、不伪配；最终 tarball 已在真实 DSH 浏览器完成整页 reload、Host 停机 fail-visible、保留最后成功证据及同 profile/端口恢复。经复核的新 Skill 可形成内容寻址 inactive Generation，真实 DSH 已验证 future-Session-only、重启固定和 root rollback；Retention→promotion gate、canary/outcome 仍未重建。

Gateway 已统一 Telegram/飞书普通文本 outbound、幂等、限流、uncertain 恢复、transport observation 和健康快照；Web 已做真实浏览器读取/刷新/断连恢复。现有 Skill 的同版本跨 Goal 精确纠正只形成等待完整 baseline Bundle 的 investigation。existing-Skill Candidate、完整返工/成本/复用/Retention/负迁移/回滚归因、真实飞书 exact 消息、真实 provider、Hermes paired 和长期数据仍未达标。

V4.19 贯穿红测发现 V4.18 把治理生成的 admission/holdout 都标成 assembled，导致确定性 Admission 固定返回 `assembled-evaluator-not-governance-separated`；现已按 [ADR-0063](adr/0063-governance-splits-deterministic-admission-from-assembled-holdout.md) 修成“不执行 Candidate 的 deterministic admission → 独立 assembled holdout”。治理 budget deny 持久化为 `budget-deferred`，作者调用异常后立即持久化 `uncertain`；Host/Web 只读展示 phase、0–2 次调用、token、retry 与脱敏失败分类，仍不暴露 protected Goal、evaluator、provider identity 或路径。详见 [V4.19 证据](evidence/v4-19-governance-admission-handoff.zh.md)。本机没有两套独立真实 provider 配置，因此状态仍是 `implemented`，不能升级为真实 provider `verified`。

V4.20 按 [ADR-0064](adr/0064-corrections-require-exact-durable-skill-invocation.md) 删除 correction 的 same-Session/unique-Gap 猜测：Host 从 feedback 目标回答的 durable turn 解析唯一成功 Skill invocation 和 exact Goal id/revision，歧义即 abstain；Signal 跨 Storage restart 保留有界身份，Web 分开展示 exact correction attribution 与非因果 Delivery Outcome association。详见 [V4.20 证据](evidence/v4-20-exact-durable-feedback-attribution.zh.md)。该增量没有把 correction 扩权为 Opportunity 资格或 Candidate，也没有完成 existing-Skill 再进化。

V4.21 按 [ADR-0065](adr/0065-existing-skill-improvement-requires-exact-invocation-content.md) 给 exact correction attribution 增加 durable invocation-content hash；同名内容漂移会分流，legacy 无 hash 只读。只有同 Workspace/Skill/hash 在至少两个不同 Goal 的去重纠正才形成独立 `waiting-for-baseline-bundle` 调查，Web 明示 exact version、无因果和 Candidate 阻断。详见 [V4.21 证据](evidence/v4-21-existing-skill-improvement-investigation.zh.md)。完整 Bundle baseline、skill-tree Envelope、Candidate 与晋升仍未实现。

V4.25 按 [ADR-0070](adr/0070-retention-reserves-independent-pre-candidate-goal-evidence.md) 将第五个内部 Goal 变成生成前的独立 Retention 分区，而不是运行时配置 target、外部 Case 或重用 holdout。治理以第三个 Candidate-independent author 调用形成独立 assembled Retention Case Pack；Envelope v5、Host/Remote 与 DSH Web 只暴露数量、阶段和聚合成本。详见 [V4.25 证据](evidence/v4-25-independent-retention-case-pack.zh.md)。该增量当时只到 Case Pack 准备；后续 V4.26 已补 execution/verdict，V4.27 已补权威 Web 投影。

V4.26 按 [ADR-0071](adr/0071-retention-continues-the-exact-candidate-shadow-job.md) 把 Envelope v5 Retention 分区接入 exact-Candidate Shadow 的同一 DSH Jobs 任务。Admission 每次重验 Case Pack hash/run root；Retention 重读 durable Shadow state/report、Lineage v3、subject、Candidate tree、DSH revision、预算和 composition 后，才以零 proposer 调用执行 paired Trial。运行按 Candidate/Admission/Envelope/Shadow/Case Pack 内容寻址并加锁；terminal verdict 可幂等复用，status/reason/evidence 脱钩会 fail closed。详见 [V4.26 证据](evidence/v4-26-exact-candidate-retention-execution.zh.md)。它仍无 release authority；promotion eligibility、canary、真实 provider outcome 仍 pending。

V4.27 按 [ADR-0072](adr/0072-web-joins-owner-projections-with-exact-lineage.md) 让 `ReviewInbox` 与 `InternalSkillRetention` 各自保有 Shadow/Retention 权威制品，再由 Host 按 exact lineage/tree 只读拼接。Retention root 缺失表示未运行；prepared、terminal、verdict/token 形状或内容地址篡改会告警。Remote/Web 不下发 Host path、protected Goal/Case、evaluator、provider 或 proposal，只展示 holdout/Retention 对照、composition、trial、calibration、proposer=0、model/token/cache 与无发布权。详见 [V4.27 证据](evidence/v4-27-shadow-retention-web-projection.zh.md)。后续 [V4.28](evidence/v4-28-shadow-retention-real-browser.zh.md) 已从最终 tarball 安装到隔离 DSH profile，验证整页 reload、Host 停机 fail-visible、最后成功证据保留和同 profile/端口恢复；真实 provider Retention 仍 pending。

| 能力 | 当前状态 | 已有证据 | 仍缺 |
|---|---|---|---|
| 原生 DSH 插件产品形态 | `implemented` | 十一包均有 `name/inject/Config/apply`、Bundle patch、无 bin 合同；同一次 clean-profile tarball add/dump/boot/remove/readback 通过 | 陌生安装与 registry release 门禁 |
| Evidence-driven Evolution + internal Skill Opportunity | `implemented` | 自然 Goal→Host 复核/持久 Gap；跨 Goal Opportunity；四 Goal authoring/admission/holdout 与第五 Goal Retention 预密封；Candidate v2/Lineage v3/Envelope v4-v5；exact-Candidate assembled Shadow 与同 Jobs 内容寻址 Retention verdict；内容寻址 Generation、future Session pin、restart 与 rollback；[V4.22](evidence/v4-22-runtime-source-target-removal.zh.md) 删除公开配置，[V4.23](evidence/v4-23-content-addressed-generation-runtime.zh.md) 删除活动 Git source/ref，[V4.24](evidence/v4-24-exact-candidate-shadow-cleanup.zh.md) 物理删除历史 target/draft/proposer/Retention/canary/control 表面，[V4.25](evidence/v4-25-independent-retention-case-pack.zh.md) 重建独立 Retention Case Pack，[V4.26](evidence/v4-26-exact-candidate-retention-execution.zh.md) 执行 exact Candidate Retention，[V4.27](evidence/v4-27-shadow-retention-web-projection.zh.md) 投影 exact Shadow/Retention，[V4.28](evidence/v4-28-shadow-retention-real-browser.zh.md) 验证新视图真实浏览器失败恢复 | Retention→promotion gate、existing-Skill 完整 baseline Bundle/Candidate、canary/outcome、真实 provider、长期误晋升/回滚数据缺失 |
| Software Delivery P2A–P2D | `implemented` | 真实 Git、原生 Tool/Goal、Draft PR、checks；Outcome 只从 source-linked Session call/result pair 读取，经官方 durability checkpoint 后投影，并可在 cold Session start 幂等补记；十一包 clean-profile 内从 packed Tool 完成原生 Goal | 真实长期任务与 checkpoint 前 hard kill、checkpoint 后投影前 kill 的跨进程故障注入 |
| GitHub Review Follow-up P3.2 | `implemented` | exact-head allowlist、bounded follow-up、重启去重、cache parity | 真实 reviewer 返修闭环和多日 resident |
| Web Control Plane | `verified` | packed artifact、真实 DSH Workspace/Host/Client Module；浏览器 pause→Host restart→persisted pause→resume/refresh；Goal metrics 的 Workspace/current/baseline 聚合和最近证据来自 Host 权威 Remote；最终 tarball clean-profile 中以四个原生 DSH Session/Goal 形成 Opportunity，显示 `ready-to-seal`、2/1/1 分割、目标正文保护和零 Candidate；在线刷新、断线保留最后快照并 fail visible、同 profile 恢复、Outcome 幂等 1→1，console error 0 | 陌生用户可用性、真实 provider 价格与长期数据 |
| Runtime Readiness | `implemented` | 原生 Loader/Command、tarball 生命周期 | v0.1 全包诊断和陌生安装数据 |
| Telegram 单私聊 | `implemented` | 已迁移 DSH Gateway；真实 DSH Workspace/Agent Loop、Commands、Approval、Goal/Schedule、Gateway durable ingress/outbound、cache parity、联合 tarball lifecycle；私有 Delivery Store 已删除；真实 assembled long-poll failure→Gateway `degraded`→成功 poll→`ready` | 真实 Bot 冒烟和多日证据 |
| Evolve Channel Attention | `implemented` | Telegram/飞书 Candidate review/inactive promotion decision、concrete routes、显式 Workspace、durable notice、request parity；Evaluator Draft 表面已删除；进入十一包总装 | 真实渠道验证与多日移动端数据 |
| Goal Continuity | `implemented` | JSONL cold resume、SIGKILL、原生 Goal round limit | 多 Workspace 绑定、生产 soak |
| Resident OS unit | `implemented` | disabled Bundle、原生 `/resident`、exact hash/service-id 确认、无 bin tarball、十一包总装、launchd/systemd 与 macOS crash 测试 | Linux 真机和多日 soak |
| Workspace DSH Gateway | `implemented` | `dsh-gateway` 直接替换旧包且无兼容层；exact endpoint/Adapter account/routeIds deny-by-default；原生 Workspace/Session/Agent create/resume；持久 ingress/outbound 幂等与 uncertain 状态机；按 account 串行、明确限流重试、turn/end 门、重启后原生 turn/end 唤醒、畸形 success 保守降级；[V5.1](evidence/v5-1-gateway-transport-health.zh.md) 聚合 Telegram/飞书脱敏 transport observation；[V5.2](evidence/v5-2-gateway-web-health.zh.md) 以同包只读 Remote/Client 在真实 DSH 浏览器验证读取、刷新、失败清空旧快照与恢复；[V5.3](evidence/v5-3-feishu-native-image-ingress.zh.md) 固定文本摘要兼容并把 exact 原生图片引用纳入幂等/漂移判断 | exact 飞书 chat/user 消息闭环、真实渠道长期运行与 paired benchmark；通用文件需官方 DSH 内容契约 |
| 飞书 Adapter | `implemented` | [AS-2](evidence/as-2-feishu-channel.zh.md)：官方 SDK WebSocket；exact allowlist；原生 Agent/Command/Approval/continuation；Gateway outbound journal、429/uncertain、单渠道及双 Workspace 真实 Host、双 Agent完整 composition parity、tarball lifecycle；私有 Delivery Store/worker 已删除；真实 App 身份请求、标准代理 WebSocket 与 setup-only pairing transport；同包原生 DSH Web 从最终 tarball完成配对生成/复制/取消及 routes-mode Gateway 权威 transport/outbound 健康读取/刷新/Host 停机失败/同端口恢复，console error 0；assembled transport error→`degraded`→message→`ready`；[V5.3](evidence/v5-3-feishu-native-image-ingress.zh.md) 以官方 message-resource 端口下载图片、整批校验、DSH AttachmentStore 保存和 assembled Session exact readback 证明外部 `fileKey` 不进入 Session | 用户发送一次配对短语后的 exact route 入站/回复/Approval 与多日重连；普通文件/音视频、文档/知识库/云盘/多维表格仍 pending |
| Hermes paired benchmark | `implemented` | [EV-1](evidence/ev-1-hermes-paired-benchmark.zh.md)、[SD-1](evidence/sd-1-hermes-paired-benchmark.zh.md)、[LC-1](evidence/lc-1-hermes-paired-benchmark.zh.md) 与 [AS-1 approval](evidence/as-1-hermes-paired-benchmark.zh.md) 四个确定性 slice：前两项窄场景胜出；本机崩溃恢复与 Telegram 一次性审批均 0:0 平局 | 同模型真实编码、真实 Bot/App 消息交付、真实模型长任务、真实 provider 与长期 outcome 的 paired epochs |
| Registry release | `planned` | 无 | 全部门禁、版本矩阵、用户授权 |

## 当前可安装面

当前 `main` 增量通过根级 `pnpm check`（文档、全包 typecheck、测试和构建）；其中
`dsh-gateway` 7 files/24 tests、`dsh-evolve-web` 2 files/18 tests、`dsh-evolve-attention` 4 files/11 tests，
`dsh-evolve` 49 files/186 tests passed、1 file/1 test skipped；`dsh-evolve-web` 2 files/18 tests passed。Cache Contract 全通过；Doctor 十一包
原生合同 22/22，十一包 clean-profile 最终 tarball 的 add/dump/boot/真实
Session+Goal+Storage+Tool/dispose/remove/reboot/readback 1/1（60.96 秒）；独立 Doctor packed
add/Loader/command/remove 1/1（10.35 秒）。V4.24 删除旧浏览器 acceptance fixture，并用 DSH Web 组件测试固定“纠正进入
自主内部治理、不出现路线选择”；V4.28 已用 test-only exact-lineage fixture 从最终 tarball 重跑完整评测视图的真实浏览器 reload/断连/恢复，fixture 不进入发布包。

十一个包可生成 tarball 并通过 `dsh plugin --profile web add` 安装：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-goal-continuity`、`dsh-resident`、`dsh-gateway`、`dsh-feishu`。外部路由、自动恢复和 OS 部署默认关闭。没有任何 EvoForge 独立 Runtime、网站、daemon 或产品 CLI 是受支持入口。

## 当前限制

- 固定 rc.5 源码是唯一支持证据；兼容范围不能由宽 peer range 推断；
- v0.1 浏览器复验已完成；真实 provider cache-read/TTFT 仍需有预算的 paired soak；
- 自我发现只允许从 DSH 内部 Goal、Gap、失败、纠正、结果与复用证据学习；同 Goal retry 不计独立证据，任何 Opportunity/Candidate/Retention verdict 自身都没有安装、激活或发布权；配置已不能预选 Candidate Skill，authoring/admission/holdout/Retention 样本在 Candidate 调用前隔离，Candidate v2/Lineage v3/Envelope v4-v5 显式绑定 seal，Shadow 与 Retention 只消费 exact Candidate 且零 proposer，缺失 Skill baseline 不再伪造占位 Skill，review 后的新 Skill Publisher/future Session/root rollback 已实现；Retention→promotion gate、canary/outcome、真实 provider assembled 评估、长期负迁移率和模型缺口质量仍缺；
- Hermes/OpenClaw/HanaAgent、论文、市场和开源实现只用于设计期调研与冻结 benchmark；运行时外部 Skill 搜索、获取、下载、导入或市场功能不属于本项目；
- 真实飞书 exact route 用户消息/回复/Approval、真实 Telegram/飞书 paired、真实 provider、陌生用户和生产多日证据仍缺失；assembled 图片链路不替代这些真实门禁；
- 固定 DSH attachment v1 只有栅格图片契约；飞书普通文件、音视频及文档/知识库/云盘/多维表格尚未完成；
- 自动化 `implemented` 不能替代真实 outcome，也不能支持笼统的“优于 Hermes”；
- 不 merge、不发布 registry、不部署生产，除非用户另行授权。
