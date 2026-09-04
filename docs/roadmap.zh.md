# EvoForge v0.1 路线图

> 2026-09-04 当前执行顺序：alpha.5 兼容性、安装面、统一单页控制面和旧固定弹层清理已经收口；V5.215 已在最新 DSH
> canonical `origin/master` `d347e703908d0406b7a7ef80e3a0e594d86b2215` 审计支持组合上完成全量 `CHECK_RC=0` 复验，并修复 resident
> Feishu 授权返回/在途回调、Gateway Agent resolution、出站提交与卸载的屏障；V5.163 已把开源
> 可用性缺口按证据分层；当前一边持续收口本地可发布可靠性，一边按授权条件攻真实
> Feishu/Telegram、双真实 Provider、Hermes paired 与长期效果证据。任何一项发布门未通过都不创建 tag。
> 最新远端 DSH `master` 为 `d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`，根构建仍有上游类型入口缺陷），可构建支持基线仍为
> `dsh-v0.1.2-alpha.5`。V5.86 还清除了 Evolution 兼容导出的 fixed overlay，见
> [V5.86 证据](evidence/v5-86-remove-stale-evolution-overlay-2026-09-04.zh.md)。alpha.5 的迁移事实见
> [迁移审计](research/dsh-alpha5-migration-audit-2026-09-03.zh.md)和
> [V5.69 证据](evidence/v5-69-dsh-alpha5-migration-2026-09-03.zh.md)。

## 下一步执行队列

1. **P1：真实 Feishu AS-2** — 用全新隔离 run root 完成陌生私聊配对、Host 批准、原生回复、`/feishu`、官方 Schedule、一次性 Approval、持久 notice、冷重启后新消息、卸载和 Session readback；任何未到达事件都记录为失败事实，不改写结果。
2. **P1：真实 Telegram 外部通路** — 取得真实 Bot route 的首次连接、陌生用户授权、回复、断连/恢复和卸载证据；loopback fixture 只能作为工程回归，不能替代外部门。
3. **P2：双真实 Provider RP-1** — 在同一任务、模型、权限、预算和固定 DSH revision 下使用两套独立 Provider，验证 Candidate-blind Holdout/Retention、成本/时延/cache 和付费不确定性恢复。
4. **P2：Hermes paired 与长期效果** — 对同一任务和资源条件运行 Hermes paired benchmark，并持续收集误晋升、负迁移、遗忘、恢复、重复外部效果和精确回滚率；任何缺样本保持 `not-measured`。
5. **P2：发布** — 只有上述门、clean-profile、真实浏览器、卸载/回滚和用户文档全部可复核为 `passed`，才在 `main` 创建 annotated SemVer tag；之后每个验证迭代继续使用 tag，不以 Git 分支保存 Candidate。

> 当前状态：已验证提交统一在 `main`；`dsh-gateway` 已替换旧 Router 并完成公共 outbound/健康 Web 的真实浏览器失败恢复验收，飞书图片已在 assembled DSH 中进入 Agent，运行时外部能力获取相关偏差表面已删除；V4.54 又移除了治理包与 Shadow 报告中残留的 `search` 语义。缺失 Skill Candidate 已形成 Retention/Promotion/Canary/Rollback 活动纵切；现有 Skill 已完成完整 baseline、protected whole-tree Candidate、exact Holdout/Retention、独立发布门和最终包浏览器生命周期。V4.46–V4.49 已完成 existing/missing Skill 的 Canary、rollback 与最终包门禁；V4.50–V4.53 建立 exact 跨 Goal 复用、后续 Outcome、尝试间工作与失败调查的非因果投影。V5.22 已把飞书纠正为 resident Gateway Host pairing，并从最终 tarball 真实 rc.2 App 完成 DM→code→Host approve、三次 native Session/回复与 Host 冷启动恢复；direct 文本主路径已通过，Approval/Schedule/group/failure/长期重连仍待完成。V4.55–V4.56 的双真实 Provider 入口仍严格为 `NOT_RUN`。下一阶段关闭飞书剩余 AS-2 门，再取得真实 Provider 结果并做真实内容/权限；Hermes paired 仍未完成，普通文件/音视频仍 pending，v0.1 未发布。
> V5.10 已把真实 Generation 晋升/回滚与活动 pointer 原子记录，并从最终 tarball 验证 Web 晋升、reload、两次 Host 冷恢复、Canary root rollback、官方卸载和原生 Web readback。它只提供 mutation audit，不替代真实 Provider/长期 Outcome/paired 效果证据。
> V5.11 已在该 mutation audit 上增加严格、有界、非因果的 post-selection Outcome 窗口，按 Session-pinned selected/previous/other Generation 展示 Goal、结果和 metrics；最终 tarball 已验证真实 Session Outcome、断线保留、两次冷恢复、整页 reload、卸载和原生 Web readback。V5.12 又以 Workspace-only opt-in policy 重建 existing-Skill 窄自动晋升，只允许 exact append-only/effect-clear/non-regressing 指令 Candidate，并接入原生 Jobs、durable pause、崩溃恢复及 Host/Web 权威状态。长期率、真实 provider 和因果效果仍 pending。
> V5.13 修复冻结 EV-1 benchmark 与活动内容寻址架构之间的漂移：runner 删除已失效的 Git Skill source，改用 sealed `skill-bundle`、`GenerationBundleRepository` 和 expected-active rollback；四个 frozen Hermes epoch 已重新通过且结果未改写。根级检查现会类型检查 EV-1 runner，但这仍不是同模型真实 paired 证据。
> V5.14 从冻结 V5.11 `b0e4360` 构建十一包历史最终产物，经官方 DSH CLI 安装后由原生 Agent/Goal 写入内部 Gap，再用当前十一包原位升级；旧 Gap、新 Goal→Opportunity、唯一 Bundle 组合、卸载和两条原生 Session/Goal readback 全部通过。它证明 pre-release migration floor，不冒充已发布 tag→tag 或真实外部验收。
> V5.15 把 DSH 官方 `dsh-v0.1.1-rc.2`（`b150a55`）作为独立设计审计基线：[直接源码确认](research/dsh-current-attachment-contract-2026-08-24.zh.md)其 Files API 仍只承载图片，核心没有 generic file/audio/video block。普通文件/音视频继续是上游契约缺口，不扩张 Gateway。
> V5.16 已让 rc.2 与 rc.5 同时进入 exact allowlist：两版分别通过十一包 fresh-install、冻结前代升级、原生 Goal→Agent Loop→Gap、future-Session 固定/回滚、飞书聊天/内容 Approval/全通道缓存及卸载 readback。矩阵拒绝未知 revision、版本错配与 tracked dirty；下一门仍是真实 Provider、真实飞书和同条件 Hermes paired，不是继续扩张 Gateway。
> V5.17 已以真实 DSH Agent/Goal/`complete_delivery`、JSONL Session、StorageDomain、两个独立进程和 `SIGKILL` 验证 checkpoint 前与 checkpoint 后/Outcome 前两个窗口；冷恢复不调用模型、不重跑 Tool，外部效果保持一次。Software Delivery 仍缺真实长期任务和同模型 Hermes paired，不因此升级为整体完成。
> V5.18 已推翻飞书测试中用普通 `agent.followup()` 文本冒充 Schedule 的旧证据，改为真实加载官方 DSH Schedule、通过原生 `schedule_create` 写入 Session 并等待 create→dispatch→follow-up；现有 Gateway turn journal 再以 `turn/end` 门只向 exact 飞书线程投递一次。没有新增 scheduler、Gateway 业务或 Feishu 私有日程状态；真实平台与 paired 门仍未通过。
> V5.19 又把该路径推进到真实进程故障：子进程在 create 已由官方 Session flush 持久化、dispatch 尚未发生时被 `SIGKILL`；第二个 Host 由 Feishu Adapter 的 exact Gateway route 恢复同一 Session，官方 Schedule 处理 overdue 并投递一次，第三个 Host 不重放。exact rc.5/rc.2 均通过；官方 followup→dispatch checkpoint 窄重复窗口、真实平台和 paired 门仍未通过。
> V5.20 已对 followup→dispatch checkpoint 窄窗口完成真实进程故障注入：先阻塞包含 dispatch 的 JSONL batch，等模型 turn 与第一次平台效果已经发生后 `SIGKILL`；恢复 Schedule 虽会重跑非 durable turn，但 Gateway 复用相同 route+turn intent，跨进程平台效果仍为一条。rc.5/rc.2 均通过；模型/成本重复、真实平台和 paired 门仍未通过。
> V5.21 已把真实飞书 AS-2 升到 epoch-2：官方 Schedule 在活动 Gateway 前加载，真实验收必须经 agent-scoped `schedule_create` 观察精确一次 create/dispatch/Schedule 插件来源 `user/message`、同 route delivered 增量和卸载后原生 Session readback；关闭终态解码器拒绝旧 epoch、缺 Schedule 与损坏报告。合同 9/9、类型和 Feishu 52/52 通过；真实 App 长连接已启动，exact route 配对仍待完成，direct/group 仍严格 `NOT_RUN`。
> V5.22 已按 current Hermes 源码事实重做 resident pairing，但用 DSH Host 单 Storage Domain 原子 pending→grant、hashed code 和 native Workspace/Session gate 避开其持久化缺口。最终 tarball 的真实 direct DM 已完成配对、三次 native Session/回复和冷启动恢复；当前 Command palette 无 `/feishu-pair`。剩余门是重启后新增消息、真实 Approval/Schedule、group/failure/长期重连，不是重新引入 setup workflow。
> V5.23 已把仍停留在静态 chat/user route 的 AS-2 runner 重构为 resident pairing epoch-3：零预授权飞书 route 启动，未知 DM code 由 Host批准到 native Session，再关闭 reply、Command、官方 Schedule、Approval、动态 notice、Host 冷启动新增消息和卸载 readback 十三项门；启动前不再填写 conversation/user/chat kind。动态 paired route 同时进入 Host notice seam，assembled Approval/notice 已通过；完整真实 epoch-3 仍 `NOT_RUN`。
> V5.24 已增加 resident grant 精确撤销：Pairing Domain 原子 grant→revoked、幂等 receipt、下一条 DM 重新 code；静态 route 和活动 ingress/outbound effect fail closed，Session 不删除。Typert Remote 与 Gateway Web 只为动态 route 提供二次确认。最终 tarball 已在真实 rc.2 profile 升级/冷启动并恢复现有 route、3/3 journal 与 ready transport；未实际中断项目所有者的授权。
> V5.25 已让默认根级开发门与最新 rc.2 源码一致：活动示例 Case Pack 精确锁 rc.2，补齐测试 LLM `prepareCall()` 和 Command images 参数；Evolve 305 passed / 1 skipped、GitHub Review 27/27。冻结 Hermes 与双版本 compatibility gate 不改写。
> V5.26 已把 Web 人工交付入口与临时测试 Host 分离：生命周期测试全程 `--no-open`，真实 Chrome 只保留常驻 `3080`，Gateway 控制面点击/刷新已通过。飞书并发卸载改为分阶段失败隔离，Gateway 先停也不能跳过平台断连；30 次 assembled 重复门与 Feishu 45/45 通过。
> V5.27 已把 Gateway/飞书分散的 fixed dialog 推翻为 `dsh-control-center`：一个 DSH 原生 `conversation.view`、一个 Cordis child Surface slot、一套公共视觉原语，Gateway 与飞书作为两个真实 Adapter 接入；十二包 clean-profile 和真实 Chrome 成功/刷新/断连保留/恢复关闭该纵切。Evolution 复杂控制面尚未迁入，下一步按同一 seam 渐进迁移，而不是再造全局 Router。
> V5.28 已完成这项迁移：`dsh-evolve-web` 的活动 registration 现在贡献 `evoforge.control.surface`，不再注册旧 sidebar fixed dialog；Control Center/Evolution 的类型、测试、套件打包和隔离 DSH add/dump/boot/remove/readback 已通过。迁移后的 Evolution 在真实 Workspace/Session 中的最终 tarball 浏览器 reload/断连/恢复仍是发布前门。
> V5.65 已把常驻 Gateway 的 pending pairing projection 接入同页低频轮询：陌生私聊到达后无需手动刷新或第二个网页即可出现在原生 `渠道` Surface；轮询失败保留最后快照，手动刷新会使旧响应失效。该 UX 增量不改变真实飞书 AS-2、Provider、Hermes paired 或长期效果门。
> V5.66 已在同一渠道页显示连接/最近活动/最近错误时间，明确区分 transport ready 与平台事件到达；仍不进行平台探测或凭据读取。
> V5.67 已为公共 Control Center 增加原生 ARIA tabs 键盘导航和唯一 `tabpanel`：方向键、Home/End、roving `tabIndex`、鼠标和移动端都留在同一个 DSH `conversation.view`，并通过真实单页刷新恢复验证；不新增网页、Router、Session 或模型调用。
> V4.38 已在 existing-Skill Candidate proposer 前生成并校准 Candidate 不可见的完整 `skill-tree` holdout Envelope；V4.39 已把 exact Envelope 纳入 Candidate 内容身份并消费该 Envelope 与 V4.37 exact 双树执行 assembled paired Trial。下一门是独立 Retention/Canary/晋升/回滚，而不是再次生成或搜索能力。
> V4.40–V4.45 已完成 Retention、发布门与最终包浏览器生命周期；V4.46–V4.48 已完成 existing-Skill failed-Outcome Canary、权威 Control/Remote/Web、独立 expected-active rollback gate 与最终 tarball 浏览器故障恢复；V4.49 已完成 missing-Skill 同类最终包故障恢复。下一门是两套独立真实 provider。
> V5.68 修复 macOS assembled `0.1.1-rc.2` 中 dsh-telegram 共享 `tsdown clean` 构建竞态，并用 `check:ci`
> 固化防回归检查；远端矩阵尚待复跑，真实外部验收门状态不变。详见 [V5.68](evidence/v5-68-ci-telegram-build-race-2026-09-02.zh.md)。
> V5.84/V5.85 已补齐 alpha.5 完整检查证据与 DSH preflight；下一轮继续推进真实常驻渠道和 paired 门，
> 不因本地质量门通过而提前发布。
> 更新日期：2026-09-04。V5.215 证据：[Hermes EV-1 确定性控制面对照](evidence/v5-215-hermes-ev1-rerun-2026-09-04.zh.md)；
> V5.214 证据：[渠道授权返回后的销毁闸门](evidence/v5-214-channel-auth-dispose-guard-2026-09-04.zh.md)；
> V5.213 证据：[Feishu 在途回调排空](evidence/v5-213-feishu-inbound-drain-2026-09-04.zh.md)；
> V5.212 证据：[Agent resolution 与卸载屏障](evidence/v5-212-gateway-resolution-dispose-barrier-2026-09-04.zh.md)；
> V5.211 证据：[出站提交与卸载屏障](evidence/v5-211-gateway-submit-dispose-barrier-2026-09-04.zh.md)。

## 开发与发布纪律

- 仓库自身只在 `main` 小步 commit，并在每批检查通过后实时 push 到 `origin/main`；不再创建 feature/release branch；
- 运行时 Candidate/Generation 进入 Workspace-scoped 内容寻址存储，不使用 Git branch；
- 普通进度 commit 不打发布 tag；只有冻结的核心集合通过完整门禁，才创建 annotated semantic tag；
- `dsh-software-delivery` 为用户仓库生成 worktree/Draft PR 的能力与上述项目自身纪律相互独立。

## 已有实现

- 当前活动 Evolution：内部 Gap/Opportunity/Candidate、独立治理、exact-Candidate Shadow/Retention、future-Session Promotion Eligibility、failed-Outcome sealed canary evidence、Generation、Session pin、review 和 rollback；历史 P1 静态 target/Draft/Retention/canary 编排已撤销，新的 canary 只从内部 exact evidence 重建且无发布权；
- P2A.1–P2D.1：原生 Skill/Tool 软件交付、Draft PR、exact-head checks、交付 Outcome；
- P3.1/P3.2：Telegram/飞书进化注意力和 GitHub review follow-up；
- LC-1/LC-2：Goal cold resume 与用户级 OS service unit；
- DSH Web review、复用 Gateway transport facts 的 Runtime Readiness、Workspace DSH Gateway、已迁移的 Telegram 与飞书 Adapter。

这些条目表示内部实现和自动化证据存在，不等于当前发布形态已经满足 v0.1。

## V0 — 权威集成基线

- 以最新完整能力为基础合并 ADR-0041 原生插件修正；
- 所有用户包使用 DSH Bundle、Cordis plugin、Skill、Tool、Command 或 Client Module；
- 删除 `dsh-evolve`、`dsh-delivery`、`dsh-resident` 产品 bin；
- DSH/Cordis 只作为 peer + dev dependency；
- 建立覆盖全部包的 clean-profile tarball add/dump/boot/remove/readback gate。

退出门：仓库只有一个权威集成分支和一套真实用户安装路径，原生 DSH 数据在卸载后仍可读取。**当前十二包统一 clean-profile gate 已完成；第十二包是只含 DSH 原生 Client 组合面的 `dsh-control-center`。**

上游版本扩展门：每个新的 DSH RC 必须作为独立 assembled 矩阵目标完成当前十二包安装、dump、boot、真实
Agent/Session/Goal 路径、reload/dispose、前代升级、卸载和原生 readback；只有设计审计不能扩大 peer/support 声明。

## V1 — Workspace DSH Gateway

- 直接消费 DSH `WorkspaceRegistry`、Agent、Session、Commands、Approval 和 StorageDomain；
- 静态、可审查、默认拒绝地把外部 tenant/chat/thread/user 绑定到既有 Workspace，并通过原生 API 创建或冷恢复稳定 Agent/Session；
- Gateway 统一有界持久化 ingress 与普通文本 outbound delivery；Adapter 只保留平台协议、实际发送与平台特有 UI；
- Telegram 成为第一个 Adapter；路由核心不复制 DSH Session、Goal、Schedule 或权限。

退出门：两个 Workspace 的输入、输出、Commands、Approval、Goal 和文件权限在重启前后无串线。**现有 ingress/route 内核已由 Telegram + 飞书同一真实 Host assembled gate 完成；公共 outbound intent/journal、幂等、按 account 串行、明确 rate-limit 有界重试、turn/end 门、uncertain 恢复和脱敏健康已进入 Gateway，两个 Adapter 的重复 Delivery Store/worker 已删除。Gateway 已校验并聚合 Telegram long-poll 与飞书 WebSocket 的 exact-route transport observation，覆盖 degraded→ready 恢复；同包统一 Gateway Web 已从最终 tarball 在真实 DSH 浏览器验证读取、刷新、Host 停机清空旧快照和同端口恢复。**

## V2 — 飞书 Adapter

实现状态：Adapter、Gateway 公共可靠投递、真实 DSH 单 Workspace 组合、双 Workspace 双渠道同 Host 重启隔离、Telegram/飞书进化注意力、tarball lifecycle 与十二包总装已完成。旧 setup-only Session 配对已删除；resident Adapter 现于 Bundle boot 连接，陌生私聊在 Agent 前回 code，Host Web 原子批准到当前 native Session，未来消息无需重启即可采用 exact grant。动态 grant 现可由 Host Web 两步精确撤销；静态 route、活动 effect 和 Session 删除均 fail closed。Gateway/飞书 Web 已进入 `dsh-control-center` 原生控制台，不再用 fixed dialog。真实用户已完成 DM→code→Host approve，并以普通文本、原生 `/new` Command、普通文本三次进入同一 native Session、收到三次回复；Gateway journal 为 3 ingress/3 outbound、零 pending/uncertain/failed。Host 干净重启后 exact grant、Session、journal 与 `official-feishu-websocket: ready` 均恢复且无重复投递。仍需补重启后新增消息、实际撤销/重新配对、真实 Approval 卡片、官方 Schedule、group policy、故障注入与长期重连。图片纵切仅证明原生 `ImageAttachmentRef`；文档/Wiki/Drive metadata/Bitable 的 assembled Tool/Approval 已通过，但真实 App scope、资源权限和数据仍待验收。普通文件、音视频继续 pending，不发明 Gateway file block。

V5.8 的 AS-2 已把 V2 的真实平台退出路径编码为 fail-closed 入口；V5.21 的 epoch-2 又把官方 DSH
Schedule create/dispatch/插件来源 `user/message`、同 route delivered 增量与卸载后 readback 纳入关闭 hard gate。
最终 tarball、官方 DSH CLI、生产飞书 transport、exact route、原生 Session/Command/Schedule/Approval、Gateway
durable notice、dispose/remove/readback 都必须成立；未授权时零身份/凭据读取。当前 9/9 合同通过，但
direct/group 两个真实 epoch 均为 `NOT_RUN`。

V5.18 又把 V2 的日程回送从“普通 follow-up 代称 Schedule”修正为官方 DSH Schedule assembled 纵切：真实
`schedule_create`、Session `schedule/change` create/dispatch、Schedule 插件来源到期 `user/message`、Agent turn、Gateway
durable `turn/end` 门和飞书 thread send 全部在同一 Host 中成立。V5.19 再以真实 `SIGKILL` 证明 create 已
checkpoint、dispatch 前死亡后，exact route 冷恢复只回送一次且再次启动不重放；该门在 rc.5/rc.2 均通过。
V5.20 进一步在第一次平台效果后阻塞 dispatch durability 并 kill；恢复虽然重跑模型 turn，Gateway 仍不产生
第二次平台效果。它不替代 AS-2 真实平台，也不证明该窄窗口中的模型、token、时延或成本 exactly-once。

- 支持静态授权的私聊或群聊文本、原生 Command、一次性 Approval、最终回答、Goal/Schedule 与进化注意力；
- 支持按独立部署权限启用 document/Wiki/Drive metadata/Bitable 的有界原生 Tool 读取，每次走 DSH Approval；
- 凭据、身份与 Workspace route 只能由部署配置决定；
- 事件去重、限流、结果不确定状态和 Cordis dispose 完整；
- Telegram 与飞书共同证明公共渠道接缝，不预建更多平台功能。

退出门：fake API/协议测试、真实 DSH 双 Workspace assembled 测试，以及 exact 飞书 chat/user 下的入站、回复、Command 与 Approval 冒烟。本轮按项目所有者要求不验证 Telegram。

## V3 — Workspace-scoped Evolution

- Candidate、Case Pack、Generation、反馈、预算、review 和 rollback 都有 Workspace 归属；
- 当前 Session 固定 Generation，晋升只影响同 Workspace 的未来 Session；
- 跨 Workspace 引用和状态损坏 fail closed；
- 保留现有 evaluator、Retention、Protected Action、成本和 Cache Contract。

退出门：Workspace A 完成纠正、Candidate、评测、晋升和 future-session 生效时，Workspace B 与 A 的旧 Session 均不变化。

实现状态：上述链路已由固定 DSH 源码的真实 Host 双 Workspace assembled test 完成，并覆盖重启持久化；真实 provider outcome 仍属于 V4。

## V4 — 内部经验自我发现与双速进化

- 用户只提交自然语言 Goal；系统从 Capability Map 自主命中适用、已验证能力，不显示开场选路菜单；
- 无适用能力时产生可复核 Capability Gap；同一 Workspace 内至少两个独立 Goal 的重复缺口才形成 Skill Opportunity；
- Opportunity 达到至少四个独立 Goal 后，先由治理面密封 authoring/admission/holdout；存在第五个或更多独立 Goal 时再保留一个 Candidate 不可见的 Retention 样本。作者看不到任何 protected 组，样本不足不花预算或生成 Candidate；
- 现有已安装 Skill 的改进先绑定调用时完整 Bundle，再从官方 Feedback/Session 服务密封真实纠正；至少四个不同 Goal 后才隔离 authoring/admission/holdout，第五个及以上保留 Retention。当前已完成该证据门，下一步是 whole-tree author 与 paired evaluation；
- Skill 名和候选方向由内部 Goal、失败、纠正、结果、复用与保留证据推导，不由用户或部署者预选 exact Skill；
- Skill 的 identity、source、scope、version、content hash、权限和 verification state 可追踪；
- 候选按 whole-Skill folder 原子版本化，始终 inactive、Workspace-scoped、内容寻址；
- 在线快环只捕获可归因 signal/gap/outcome，离线慢环负责跨 Goal 归纳、候选生成、迁移、保留与遗忘；
- evaluator、holdout、gold、hard gate 和 release eligibility 位于 Candidate 不可读写的治理面；证据不足允许 abstain。

外部生态、论文、Hermes/OpenClaw/HanaAgent 和开源实现只用于**设计期调研与冻结 benchmark**。本项目不建设运行时外部 Skill 搜索、下载、导入、市场或“能力获取”功能。

退出门：在未见 Goal 上自动命中已有 Skill；在确实缺失时仅依据 DSH 内部真实证据生成正确候选；错误路由、未授权能力变更、
候选越界和负迁移均被 hard gate 拒绝；同一任务 paired baseline 证明首次成功率或人工选路显著改善，且
当前 Session、权限和 cache prefix 不漂移。

实现状态：**partial implementation**。DSH 原生 catalog 负责已有 Skill 的语义选择；固定
`report_capability_gap(name)` Tool 已通过真实 Agent Loop，把 active Goal 中模型确认的无匹配情况经 Host
复核后持久化。`ExperienceDrivenSkillOpportunityDiscovery` 以 durable Gap 决定资格：同 Workspace、同一
Skill、至少两个不同 Goal 才产出确定性 Opportunity；同 Goal retry、无 Goal、跨 Workspace 和证据不足均
abstain。Opportunity v3 只关联 feedback 目标回答同一 durable turn 中唯一成功 Skill 调用及其 exact Goal id/revision，
并保存模型当时实际看到的 invocation content hash，不再按同 Session Gap 或同名 Skill 猜测；同时按 stable Goal identity 跨 revision 的唯一 Gap Skill 关联 compact delivery outcome。Outcome
必须晚于对应 Gap、revision 不得倒退、歧义 fail closed；两类上下文固定 `causalClaim: none`，且不
改变资格/排序或 author 输入。`selfDiscoveryPolicies` 只配置 Workspace、run root 和日预算，不接受 Skill、路径、来源、Agent 或
workflow 选择。原生 Job author 只接收有界内部 Goal/Gap 证据，输出 instruction-only whole-Skill v1，Host
校验、内容寻址并写入 inactive/quarantined/unevaluated/never-executed Candidate。DSH Web 展示
Gap → Opportunity → Candidate 及运行状态、成本和治理边界，不显示外部发现尝试。

Existing-Skill improvement 与 missing-Skill Opportunity 分轨。V4.33–V4.45 已完成完整 baseline、protected Candidate、Candidate-blind exact Holdout/Retention、独立发布门与最终 tarball 生命周期。V4.46 只在 active Generation 精确对应 approved existing-Skill release 时消费失败 Outcome，重验专用 lineage并通过 Retention owner 物化 exact baseline/Candidate/Case Pack；原生 Jobs paired replay 只有在 baseline pass、Candidate fail 时给出无 mutation 权的 rollback-eligible，双失败进入 review，paid-uncertain 不重试。V4.47 已用独立 Host owner 重验 exact Canary，并经 expected-active compare 只回滚未来 Session；Control/Remote/Web 共用该门。V4.48 已从最终 tarball 验证实际 rollback、Session 固定、断连保留、同 profile/端口恢复、整页/进程冷恢复与卸载。下一步用两套独立真实 provider 跑出效果证据。

V4.40 将第五 Goal 密封为独立 Retention Case Pack；V4.41–V4.45 已完成 exact Retention、future-Session 发布门及最终包浏览器；V4.46–V4.48 已完成 existing-Skill failed-Outcome Canary、权威 Control/Remote/Web、独立 Host expected-active rollback gate 和最终包真实生命周期；V4.49 已完成 missing-Skill 的同类最终包真实生命周期。下一纵切是两套独立真实 provider 与长期 Outcome。

V5.10 将所有真正改变 future-Session selection 的 promotion/rollback 收口到同一 Workspace state 原子写：pointer 与内容寻址事件同时落盘，事件绑定 exact Retention、Release Decision、Canary 或显式人工 authority；重复 promotion 幂等，当前 Session pin 不变。Host/Web 只投影有界 mutation timeline 和分类计数，固定无 outcome claim、无 release authority。最终 tarball 已验证真实 Web 晋升、reload、Host 冷重启、Canary root rollback、再次 reload/冷重启和官方卸载。下一门不是继续扩张日志平台，而是用 RP-1/长期 Outcome 证明误晋升、负迁移、遗忘和误回滚率。

V5.11 复用现有 selection events 与 Delivery Outcomes，在 Control/Web 中为每次选择投影严格时间 epoch。Outcome
按 Session-pinned selected/previous/other 分桶并聚合 Goal、结果和 DSH metrics；边界相等只计 ambiguous，选择
wall-clock 不严格递增则 abstain。最终 tarball 已验证真实 Session Outcome、Host 停机保留、同 profile 恢复、
第二次冷启动、整页 reload、官方卸载和原生 Web readback。它只是 bounded monitoring foundation，不产生 Candidate、
效果 verdict、晋升或回滚；下一门仍是已授权 RP-1、真实飞书和长期 paired epoch。

V5.12 不恢复历史 `autoPromote.targets`。`automaticPromotionPolicies` 只能授权一个 Workspace，不能指定 Skill、
路径、来源、Candidate 或 Case Pack。existing-Skill sole release owner 重新验证 exact Admission、improved Holdout、
independent Retention、baseline/Candidate archives、active parent 和 durable pause；仅单一 `SKILL.md` 末尾 1–2048
UTF-8 bytes、其他整包 bytes 不变、protected-effect indicators 为空且双评测 model/token/cache 不回退时，先持久
automatic decision 与 inactive Generation，再选择未来 Session。原生 Jobs 只唤醒，无第二调度状态；Web 只读展示
eligible/pending/already-promoted/review/paused/blocked 与原因。最终 tarball 已从全新 profile 验证自动 decision、
future-Session selection、整页刷新、Host 断线保留、同 profile 冷恢复、官方卸载和原生 Web 无残留。仍缺两套真实
provider false-promotion/transfer 数据和 Hermes paired，不能据此声明 v0.1 或上位替代完成。

V4.50 新增一个更窄、不可冒充效果的观察门：Host 只在成功原生 Skill 调用完成 Session flush 且存在 active
Goal 后记录 exact name/content hash/Generation；相同 exact 版本覆盖至少两个不同 Goal 才算 Cross-Goal Skill
Reuse。真实 DSH Web 已从最终 tarball 验证 2 uses/2 Goals、reload、Host 冷启动恢复和官方卸载。该投影固定
`causalClaim: none`、`releaseAuthority: none`。

V4.51 已把 exact reuse 与同 Session/Goal/Generation 且发生在使用之后的 durable Outcome 连接，展示 missing、
attempt、recovered、ambiguous latest 和唯一 latest 的 DSH Goal metrics。该视图已经从最终 tarball 验证刷新、Host
停机时失败可见且保留最后证据、同 profile 冷恢复不重复计数及卸载；但它仍是时间上下文，不是成功率或返工因果。
下一步是两套独立真实 provider、长期负迁移/遗忘和同条件 paired benchmark，而不是按这些观察计数晋升。

V4.52 在 V4.51 的同一 Host 权威投影内增加 `Between-Attempt Work Context`：相邻 Outcome 只有在时间严格有序、
两侧 DSH Goal metrics 同源同 Goal、event seq 前进且累计 counters 全部单调时才相减；并列时间整组顺序歧义，
缺快照或回退只记 ordered transition/unmeasured。Control、Remote、Command 与 Web 共用同一差值，展示新增
turns/steps/token/cache/latency/active wall，固定无因果、无 improvement claim、无发布权。它补充返工调查所需的
可测上下文；最终 tarball 已从全新 profile 验证刷新、断连保留、同 profile 冷恢复不重复、reload、卸载及原生 Web
无残留。但它仍不能称为返工下降或 Skill 效果；两套真实 provider、长期结果与同条件 paired benchmark 仍是下一门禁。

V4.53 把重复跨 Goal 最新失败从被动数字提升为 `Exact Skill Failure-Context Investigation`：同一 exact Skill
name/content hash/Generation 必须在至少两个不同 Goal 上各自具有唯一 latest failed；同 Goal retry、后来恢复、
unknown/missing 与 latest 冲突全部不计。Host/Control/Remote/Command/Web 只投影可撤回的 review request，固定无
因果、无 Candidate/发布权，并让 eligible 行优先进入 20 行明细。最终 tarball 已从全新 profile 验证 1 个
eligible/2 个 latest-failed、刷新、断连保留、同 profile 冷恢复不重复、reload、官方卸载及原生 Web 无残留；
详见 [V4.53 证据](evidence/v4-53-exact-skill-failure-context-investigation.zh.md)。下一门仍是两套真实 provider、
长期结果和 paired benchmark。

内部 Candidate 评测已删除 `candidateAdmissionTargets`/`candidateShadowTargets` 这两套预选 exact Skill 的配置。
`candidateEvaluationPolicies` 不声明 Skill、baseline、Case Pack 或 Candidate 方向；自主治理只增加 exact DSH revision 和独立日预算。Host 先从 exact Opportunity
自动形成内容寻址的 `Skill Evaluation Evidence Seal`，Candidate v2 将 seal id 纳入内容身份；Candidate-independent 治理模块分别用受保护 admission/holdout，以及可用时的第五 Goal Retention 样本形成互不复用的 Case Pack，同 proposer model identity 在预算前 fail closed，并以零 proposer 调用校准；四 Goal Envelope v4 或带 Retention 的 Envelope v5 再绑定 seal、author-input digest、治理作者/输入 digest、
exact Opportunity 快照和禁止占位 Skill 的 capability-absent
baseline、deterministic admission 和不同的 assembled holdout。真实 assembled DSH baseline 不安装目标 Skill，
Candidate 侧才安装 exact whole-Skill；Envelope id 和 seal id 贯穿 admission、Candidate Lineage v3、Shadow 与 crash resume；
内容漂移、symlink、根重叠和任意 protected Case Pack 同 hash 都 fail closed，缺包则 abstain。新 Skill Publisher
已不再假设既有 Git source：explicit review 后生成 canonical `skill-bundle` inactive Generation，Storage/Provider
重验 exact 内容，真实 DSH Session 证明 future-only、root rollback 和重启恢复。Shadow 只执行 exact Candidate/lineage 与真实 assembled DSH composition，自身不调用 proposer；旧 capability-absent Retention/sealed-canary 编排已删除。V4.25 已用内部第五 Goal 重建独立 assembled Retention Case Pack、Envelope v5、Host/Remote 与 Web 治理投影；V4.26 已将该分区接到同一 Shadow Jobs 任务，重验 durable Shadow/Lineage/subject/tree/hash/revision/budget/composition，并以零 proposer 调用内容寻址落盘 retained/regressed/incomplete；V4.27 已由各自权威 reader 扫描 Shadow/Retention，按 exact lineage/tree 拼接并在 DSH Web 显示 verdict、reason、trial、composition、model/token/cache 和无发布权，错配只告警；V4.28 已从最终 tarball 安装到隔离 profile，以真实 DSH 浏览器验证整页 reload、Host 停机失败、最后成功证据保留和同端口恢复；V4.29 已由独立 Host gate 把 exact retained 证据转换为 future-Session eligibility，missing/prepared 等待，warning/错配/回归/incomplete 阻断，并从最终 tarball在真实 DSH Web 验证 eligible/enabled、regressed/disabled、Host 失败保留证据、同端口恢复和卸载；V4.31 已让失败 Outcome 触发新的内容寻址 Canary Job，重验同一谱系并只生成 keep/review/rollback-eligible 证据；V4.32 已让唯一 Rollback Gate 重验 exact Canary/Workspace/active Generation，并以 Store 临界区 expected-active compare 防止并发误回滚。治理包自动形成、原子安装和 paid-call uncertain restart 已通过注入式自动化测试；existing-Skill 的同类最终包动作/故障/恢复门已由 V4.48 验证，missing-Skill 同类门已由 V4.49 验证。下一步补长期 outcome，并用两套独立真实 provider 跑全链。

当前活动源码已经删除外部来源发现、Agent Skills 索引/archive、运行时 Web research、research Holdout/revision
及其 Job 编排、依赖、持久化变体和 Web 类型；Candidate Repository、Admission、Lineage、Shadow 只接受
内部 Skill Opportunity 与 canonical text bundle，不读取旧字段或提供兼容入口。历史证据页仅用于解释已撤销决策。
已补齐一层非因果 cost fact：Delivery Outcome 可保存 exact Goal-owned turn 的官方 provider usage、
cache-read/write 和 latency projection，货币成本明确 unavailable，且不影响资格/author。Host 权威 summary、
generated Remote 与 DSH Web 已展示 Workspace/current/baseline 聚合和至多 20 条最近已测 Outcome；真实浏览器已验证
在线刷新、Host 断连保留最后快照并显式报错、同 profile 重启恢复和幂等重放。失败 Outcome 现可触发 exact active internal Candidate 的内容寻址 sealed canary；自动化测试覆盖 keep/review/rollback-eligible、预算、输入与 pointer 漂移、中断不盲重试、持续监测和 DSH Jobs，V4.49 已补最终包浏览器恢复。仍待实现/验证：
correction/outcome 的因果证明，以及 rework/currency-cost/reuse/retention/negative-transfer/rollback 的完整归因、内部 Candidate 治理包的两套独立真实 provider outcome、模型缺口质量、迁移/遗忘/
长期保留，以及同条件 Hermes paired outcome。因此不能描述为“自主 Skill 进化已完成”。

## V5 — 可解释 Web 与飞书闭环

- DSH Web 展示 Capability Map、Gap queue、实际路由、Skill 来源/scope/version/utility；
- 展示 whole-Skill 候选谱系/diff、baseline/candidate/holdout、失败归因、成本/时延/cache、安全、quarantine、promotion/rollback 和 Generation/tag；
- 展示活动 pointer 原子保留的 Generation 选择时间线、授权依据和前后版本，同时明确选择事实不等于效果；
- 展示飞书 App/account/exact route、连接健康、去重、出站 journal、429 与 uncertain；
- 所有状态来自 DSH Host 权威投影，关键动作复用原生 Command/Approval；
- 完成 exact 飞书 chat/user 的入站、回复、Command、Approval 和进化 attention 闭环。

退出门：最终 tarball 在全新 profile 的真实浏览器与真实飞书 App 上覆盖成功、刷新、权限拒绝、身份错误、
429、网络不确定、重启、dispose 和卸载路径；UI 不新增 Session 模型工具/Prompt/token。

实现状态：既有 Evolve review、Capability Map/Gap、内部 Skill Opportunity、隔离 whole-Skill Candidate、admission/Shadow、飞书配对 UI、
routes-mode 脱敏健康投影和渠道底座已实现；健康面最终 tarball 的真实浏览器读取/刷新/Host 停机与恢复
已通过；assembled DSH 已验证 thread-scoped 回复/continuation 和 exact card/chat/operator 一次性 Approval，
并验证四类内容独立权限、稳定 Agent Tool schema、原生 Approval、durable result 与 dispose；V2 内容就绪面
已从最终 tarball 在真实浏览器验证四权限、Tool/Approval、future-only 语义、刷新、失败清空和恢复；真实飞书 exact
route 消息、真实卡片点击、真实 App 内容权限与完整评测演进视图 **pending**。V5.8 已提供不能用 fake transport
冒充的 AS-2 执行入口，当前 direct/group 均未实际运行。

## V6 — v0.1 验收与首个 tag

- 全包 tarball clean-profile 安装、dump、boot、真实 Agent/Session/Goal、卸载与 readback；**已完成**
- dependency loss、reload、dispose、崩溃、重复事件、429、网络不确定和身份拒绝；Delivery Outcome 的 checkpoint 前与 checkpoint 后/投影前跨进程 `SIGKILL` 已由 V5.17 完成；
- 完整 composition cache parity；**已完成，见 `pnpm test:cache-contract`**
- DSH Web 真实浏览器成功、刷新和失败路径；
- 多 Workspace、自我发现、自进化、Gateway、消息、审批、崩溃恢复和软件交付的 Hermes paired benchmark；
- 四个 deterministic frozen Hermes epoch 已在 V5.13 从当前内容寻址路径完整复跑；真实模型、真实渠道与长期 epoch 仍 pending；
- 冻结十一包 predecessor→当前十二包最终 tarball 的官方 CLI 升级纵切在 V5.27 重验；首个真实发布 tag 后仍须建立 tag→tag 升级矩阵；
- 真实 provider 的长期 retention/transfer/negative-transfer/false-promotion/false-rollback 与成本数据。
- RP-1 双真实 Provider 入口已实现并通过无调用合同门，当前 `NOT_RUN`；只有显式批准后的 `status: passed` 才算这一阶段的真实 Provider 证据。
- 四个真实 Provider authoring seam 均有 60 秒 wall-clock 上限；治理请求与 Host cancellation 组合，timeout 后沿用 `uncertain` 且不盲重试。

只有证据覆盖的场景可以声明优于 Hermes。所有核心门禁通过后在 `main` 创建首个 annotated semantic
tag；registry release 和生产部署仍需用户另行授权。
