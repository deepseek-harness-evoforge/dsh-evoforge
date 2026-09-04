# 当前实现状态

> 更新日期：2026-09-04。本文只描述标准路径中的权威 `main` 工作树，不把计划或历史分支当作已交付能力。

> DSH 最新公开 tag 仍为 `dsh-v0.1.2-rc.1`（`a66e470…`），最新远端 `master` 为
> `76fda729799fe9b3848dbe2c211d4b231032b81e`；两者均已在本轮重新 fetch 并审计，干净完整构建仍被上游根级
> tsdown 入口阻断。EvoForge 当前支持声明仍锁定已完成矩阵的 alpha.5（`db6bdc…`），详见 [rc.1 迁移审计](research/dsh-rc1-migration-audit-2026-09-03.zh.md)。

> 真实飞书验收契约已更新为 epoch-4，固定 alpha.5；旧 epoch-3 不被复用。契约修复与 clean guard 的
> 外部效果前拒绝见 [V5.70](evidence/v5-70-feishu-epoch4-revision-contract-2026-09-03.zh.md)，真实 AS-2
> 仍未通过。

## V5.159：当前 Hermes revision 的 EV-1 epoch-4（本轮）

重新 fetch Hermes 后确认 `origin/main` 已从旧的 `63279301…` 漂移到
`29d0cc2602e01943ab300c0382fc9d97efb376da`。旧 current manifest 因 revision assertion 正确拒绝运行；新增
epoch-4 后在同一 DSH alpha.5、同一冻结 case pack、无网络和同一预算下重跑，校准 `2/2`，两侧 baseline 均失败、
corrected 均通过，EvoForge primary metric `0`、Hermes `1`，六项 EvoForge release-control hard gate 全部通过。
该结果仍是确定性控制面对照，不是模型质量、真实渠道或完整 Hermes paired；`hermes-paired` 继续为 partial。
详见 [V5.159 证据](evidence/v5-159-hermes-current-revision-ev1-epoch4-2026-09-04.zh.md)。

## V5.160：Hermes epoch-4 修复后的 alpha.5 全仓回归（本轮）

在 epoch-4 基准和当前 Hermes revision 文档进入 `main` 后，重新 fetch/核对 canonical DSH rc.1，使用已审计
alpha.5 支持 checkout 执行根级 `pnpm run check`，低噪声退出码为 `CHECK_RC=0`。文档、CI、套件、发布合同、
Hermes/Provider/Feishu/Telegram 验收合同、12 个 Bundle 类型检查、测试和构建均通过；真实外部门禁状态未被
虚构改变。详见 [V5.160 证据](evidence/v5-160-alpha5-full-check-after-hermes-epoch4-2026-09-04.zh.md)。

## V5.161：canonical DSH rc.1 clean-profile 兼容验收（本轮）

直接用最新 canonical DSH rc.1 跑用户套件时，先发现验收 fixture 仍调用已删除的 `sessionPersistence.load()`；按
官方当前 `open(id, 'read')` → `read()` → `close()` 契约修复，且只对已锁定 alpha.5 保留 test-only 回退。修复后
rc.1 与 alpha.5 各自 `1/1` 通过，覆盖安装、Host、Goal/Session、Tool、卸载和恢复读回。该证据扩展了 clean-profile
兼容范围，但不掩盖 rc.1 root tsdown 构建缺陷，正式支持声明仍为 alpha.5。详见 [V5.161 证据](evidence/v5-161-current-dsh-rc1-clean-profile-compatibility-2026-09-04.zh.md)。

## V5.157：用户套件官方 clean-profile 安装/卸载验收（本轮）

在重新 fetch 并核对 canonical DSH rc.1 后，使用隔离 `DSH_HOME` 实际执行官方 DSH 的
`plugin --profile web add/remove`，覆盖四个用户套件共 12 个 Bundle。安装后的 dump、Host 启动、原生
Session/Goal/Storage、真实 Tool 调用、dispose、完整卸载及卸载后的 Session/Goal 读回均通过；测试 `1/1`
通过、退出码 `0`。所有 Host lifecycle probe 均未输出浏览器打开动作，单网页约束未被测试绕过。该结果只证明
本地 clean-profile 生命周期，不改变真实渠道、Provider、Hermes paired、长期效果或 npm 发布门禁。
详见 [V5.157 证据](evidence/v5-157-clean-profile-user-suite-install-2026-09-04.zh.md)。

## V5.158：发布门禁机器可读快照（本轮）

运行 `pnpm run check:release:gates -- --json`，结果明确为 `blocked`，且无清单错误或缺失证据文件。当前阻断逐项
记录了 npm 命名空间、真实 Telegram/飞书、Provider paired、Hermes paired 和长期效果的实际缺口；因此没有创建
release tag，也没有把本地 clean-profile 通过误报成完整产品发布。详见 [V5.158 证据](evidence/v5-158-release-gate-json-snapshot-2026-09-04.zh.md)。

## V5.150：Gateway 单页补充无入站事件诊断（本轮）

真实 Feishu AS-2 已确认官方 WebSocket `ready` 但没有新人 pending；本轮在同一原生 Control Center 中增加了
“连接正常但尚未观察到平台入站事件”的 Adapter 级提示，帮助区分事件订阅/机器人/长连接问题与 DSH Agent 问题。
提示不调用模型、不新增网页、Router 或状态库；首次入站后由现有 Host `lastInboundAt` 事实自然消失。Gateway
`41/41` 测试、类型检查和构建通过。详见 [V5.150 证据](evidence/v5-150-gateway-no-inbound-diagnostic-2026-09-04.zh.md)。

## V5.151：Gateway 诊断后的 alpha.5 全仓回归（本轮）

在最新 canonical DSH rc.1 重新 fetch/审计后，以独立 alpha.5 支持 checkout 执行根级 `pnpm run check`，退出码
`0`。文档、合同、12 个 Bundle 的 typecheck、测试和构建全部通过（Gateway `41/41`、Feishu `46/46`、Telegram
`34/34`）。本轮不读取真实凭据、不产生外部效果；所有真实渠道、Provider、Hermes paired、长期效果和 npm 发布门状态
保持原值。详见 [V5.151 证据](evidence/v5-151-alpha5-full-check-after-gateway-diagnostic-2026-09-04.zh.md)。

## V5.152：常驻服务默认不重复打开网页（本轮）

修正 `dsh-resident` 的常驻 Web 行为：`noOpen` 默认值从 `false` 改为 `true`，OS service 默认追加官方
`--no-open`，只有显式 `noOpen: false` 才允许每次启动请求浏览器交接。这样 launchd/systemd 崩溃恢复不会制造
重复网页，仍由 DSH 官方 Web 页面承载所有插件 Surface。Resident 测试 `17 passed / 1 skipped`、类型检查和构建
通过；详见 [V5.152 证据](evidence/v5-152-resident-no-open-default-2026-09-04.zh.md)。

## V5.153：常驻网页交接修正后的 alpha.5 全仓回归（本轮）

在最新 canonical DSH rc.1 重新 fetch/审计后，执行根级 `pnpm run check`，退出码 `0`。文档、合同、12 个
Bundle 的 typecheck、测试和构建全部通过（Resident `17 passed / 1 skipped`、Gateway `41/41`、Feishu `46/46`、
Telegram `34/34`、Evolution `309/309`）。本轮未读取真实凭据或产生外部效果；真实渠道、Provider、Hermes
paired、长期效果和 npm 发布门状态不变。详见 [V5.153 证据](evidence/v5-153-alpha5-full-check-after-resident-default-2026-09-04.zh.md)。

## V5.154：用户安装文档统一为单网页启动（本轮）

根 README、上手指南和能力套件说明统一使用 `dsh --profile web --no-open`，并明确 Host 只启动一次、URL 复用到
已有浏览器标签页、刷新不重复启动；同时标注 resident 默认 `noOpen: true` 与当前支持的 alpha.5 DSH revision。
文档链接检查和 diff 检查通过。详见 [V5.154 证据](evidence/v5-154-single-web-startup-docs-2026-09-04.zh.md)。

## V5.155：单网页启动约束进入文档门禁（本轮）

根 README、英文 README、五个直接安装 Bundle README 和中文上手/套件指南已统一为 `--no-open` 启动说明；
`check-docs` 现在会拒绝面向用户文档中的裸 `dsh --profile web`，防止重复浏览器交接回归。文档检查和 diff 检查
通过。详见 [V5.155 证据](evidence/v5-155-single-web-doc-guard-2026-09-04.zh.md)。

## V5.156：四个用户套件 tarball 边界审计（本轮）

实际执行 `pack:suite` 生成 `core 4`、`channels 4`、`delivery 2`、`continuity 2`，共 12 个 tarball 和四份
带 SHA-256/audience 的清单；逐包归档审计确认没有 `node_modules`、`.bin` 或产品 `bin`。用户入口仍是四个能力
套件，内部 Bundle 保留独立生命周期。详见 [V5.156 证据](evidence/v5-156-user-suite-tarball-boundary-2026-09-04.zh.md)。

## V5.149：真实飞书有效凭据连接成功但无新人 pending（本轮）

使用用户提供的精确 App 凭据和真实效果授权，在新的物理 run root `/private/tmp/evoforge-feishu-as2-20260904-r2`
运行 AS-2。最终 tarball 安装、profile dump 和官方 Feishu WebSocket `ready` 均通过；完整 60 秒等待窗口内没有
当前 App 的陌生私聊 pending，runner 在配对前以退出码 `1` fail closed，没有 Agent 或平台回复/卡片/notice 副作用。
这次排除了 Secret、Loader、Bundle、overlay 和 handshake 失败，但不证明事件已抵达 Adapter；`real-feishu-as2` 继续
为 `failed`。详见 [V5.149 证据](evidence/v5-149-real-feishu-as2-valid-credential-no-pending-2026-09-04.zh.md)。

## V5.148：Telegram AS-1 API 修复后的 alpha.5 全仓回归（本轮）

在再次 fetch/核对 canonical DSH rc.1（`76fda729…`，clean）后，使用已审计可构建的 alpha.5 支持 checkout
`db6bdc…` 执行根级 `DSH_EVOLVE_DSH_SOURCE_DIR=... pnpm run check`，退出码 `0`。Telegram AS-1 执行器将可配置
官方 API endpoint 传入最终 overlay 的修复与文档、CI/套件/发布合同、12 个 Bundle 的 typecheck、全部测试和构建
共同通过；EvoForge 工作树保持 clean。该回归没有读取真实凭据或产生外部效果，真实 Telegram、Feishu、Provider、Hermes
paired、长期效果和 npm 发布门状态不变。详见 [V5.148 证据](evidence/v5-148-alpha5-full-check-after-telegram-api-fix-2026-09-04.zh.md)。

## V5.144：真实 Telegram AS-1 合同与零副作用预检（本轮）

新增真实 Telegram Bot resident pairing 的独立 AS-1 验收合同和执行器，固定可构建 DSH alpha.5 支持 revision，并单独记录
每次开发前审计到的最新 DSH rc.1。未设置精确授权短语时，入口只读取授权变量，不读取 Bot token、账户、路径，
不加载执行器，也不发起 Telegram 请求；授权后才校验官方 API、token、clean source 和仓库外隔离 run root，
并使用已验证的 DSH app-boot/最终 Bundle 骨架进入人工私聊、Host 批准、回复、幂等回放、Approval、重启和卸载流程。终态
报告绑定 manifest、EvoForge/DSH revision、最新审计 revision 和账户哈希，配对码、首条消息不入 Agent、Host 批准、
重复 update、原生 Approval、重启、卸载和 Session readback 任一缺失都不能复用。合同类型检查和 `8/8` 安全测试通过；
当前没有授权的真实 Bot 运行记录，`real-telegram-as1` 仍为 `not-run`，因此没有虚构真实 Bot 通过证据。详见
[V5.144 证据](evidence/v5-144-telegram-as1-real-contract-2026-09-04.zh.md)。

执行器接入与类型检查的具体证据见 [V5.146](evidence/v5-146-telegram-as1-executor-skeleton-2026-09-04.zh.md)。

## V5.147：Telegram AS-1 未授权运行与最终包边界验证（本轮）

在 canonical DSH rc.1 重新 fetch/clean 审计后，未设置授权和凭据运行 `pnpm benchmark:telegram:as1`，退出码为 `2`，
stdout 只有一个 `real-telegram-effects-not-authorized` 的 `not-run` JSON，stderr 无内容；没有加载执行器、读取 token
或连接 Telegram。随后将 `dsh-control-center`、`dsh-gateway`、`dsh-telegram` 打成最终 tarball，三个包均成功产出，
包内容不含 `node_modules` 或产品 CLI，EvoForge 工作树保持 clean。真实 Bot AS-1 仍未授权运行，发布门仍为 `not-run`。
详见 [V5.147 证据](evidence/v5-147-telegram-as1-preflight-pack-boundary-2026-09-04.zh.md)。

## V5.145：AS-1 接入后的 alpha.5 全仓回归（本轮）

在再次 fetch/核对 canonical DSH rc.1（`76fda729…`，clean）后，使用已审计可构建的 alpha.5 支持 checkout
`db6bdc…` 执行根级 `DSH_EVOLVE_DSH_SOURCE_DIR=... pnpm run check`，退出码 `0`。文档、CI/套件、发布合同、
Hermes EV-1 类型门、Provider RP-1、Feishu AS-2、Telegram AS-1 合同、12 包类型检查、全部测试和全部构建均通过，
EvoForge 工作树保持 clean。该结果只证明工程回归；真实 Telegram Bot executor、真实 Feishu AS-2、Provider、
Hermes paired、长期效果和 npm 发布门仍未通过。详见 [V5.145 证据](evidence/v5-145-alpha5-full-check-after-telegram-as1-contract-2026-09-04.zh.md)。

## V5.135：当前 Hermes revision 的 EV-1 epoch-3（本轮）

固定当前 Hermes `origin/main` `63279301…`，在已审计的 DSH alpha.5 `db6bdc…` 上建立独立 epoch-3，严格
复跑 `benchmark:hermes:ev1:alpha5:current` 通过：校准 `2/2`，EvoForge 主指标 `0`、Hermes `1`，Session
固定、跨 Workspace fail-closed、回滚/重启精确。旧 epoch-1/2 未改写；该证据仍只支持确定性 Skill 发布
控制面窄结论，不代表模型质量、真实渠道或完整 Hermes 上位替代。详见
[V5.135 证据](evidence/v5-135-hermes-current-ev1-epoch-3-2026-09-04.zh.md)。

## V5.136：真实 Feishu AS-2 epoch-5 仍无新人 pending（本轮）

在 `dfdac55` 主线和已审计 DSH alpha.5 支持基线上重新打包并安装最终 Bundle；配置 dump、常驻 Gateway 和官方
Feishu WebSocket `ready` 通过，但 5 分钟窗口内没有当前 App 的陌生私聊，runner 在配对前 fail closed。没有
Agent 入站或平台副作用，`real-feishu-as2` 继续为 `failed`。详见
[V5.136 证据](evidence/v5-136-real-feishu-as2-epoch5-no-pending-2026-09-04.zh.md)。

## V5.137：DSH preflight 拒绝未跟踪文件（本轮）

发现兼容性脚本使用 `--untracked-files=no`，可能把含 `??` 文件的 DSH checkout 误判为 clean。本轮改为检查完整
`git status --porcelain`，并新增 tracked 与 untracked 两类回归；4/4 测试、文档和差异检查通过。详见
[V5.137 证据](evidence/v5-137-dsh-preflight-untracked-guard-2026-09-04.zh.md)。

## V5.138：preflight 收紧后的 alpha.5 全仓回归（本轮）

在最新 DSH fetch/clean 审计后，使用已审计可构建 alpha.5 执行根级 `pnpm run check`，文档、CI/套件/发布合同、
12 包 typecheck、全部测试和全部构建通过（`CHECK_RC=0`）；Evolve `69/309`、Gateway `8/40`、Feishu
`18/46`、Telegram `8/29`，构建后工作树 clean。真实渠道、Provider、Hermes paired、长期效果和 npm 发布门
保持原状态。详见 [V5.138 证据](evidence/v5-138-alpha5-full-check-after-preflight-guard-2026-09-04.zh.md)。

## V5.139：飞书非支持首条消息先授权再反馈（本轮）

修复 `dsh-feishu` 在 Gateway 授权前过滤顶层消息类型的顺序缺陷。未知 direct DM 即使首条是普通文件、音频或视频，
也会先收到配对码且不进入 Agent；已配对 route 则经同一持久 outbound journal 获得明确的附件契约提示，重复
`messageId` 不重复外发。assembled Feishu chat 与 pairing 回归 `2/2` 通过，未调用真实凭据；普通文件、音频和
视频仍未宣称为 DSH 原生附件能力。详见 [V5.139 证据](evidence/v5-139-feishu-unsupported-first-message-2026-09-04.zh.md)。

## V5.140：Telegram 常驻 Host 配对纵切（本轮）

`dsh-telegram` 新增 `mode: pairing`，不再要求预先写入 Telegram 私聊的静态 `conversationId/userId`。它复用同一个
`dsh-gateway` 的 `authorize`、配对存储、原生 Workspace/Session/Agent 和 Gateway outbound journal：陌生 direct DM
收到一次性配对码，首条消息不进入 Agent；管理员批准后，下一条消息才由 Gateway 路由到原生 Session。动态 route
在 dispatch 前解析并绑定 Agent，避免同步 inbox claim 被错过；静态 `routeId` 配置保持兼容。已用 DSH alpha.5
clean assembled profile 通过 `unknown DM → code → Host approve → next-message dispatch`，并补齐 inbound/config
与 Web 健康解析回归；证据见 [V5.140](evidence/v5-140-telegram-pairing-assembled-2026-09-04.zh.md)。

这仍不是真实 Telegram Bot 发布证据：真实外部 Bot、陌生安装引导、生产权限和多日运行未执行，`web-control-plane`
与 `hermes-paired` 发布门仍按 `release-gates.json` 阻断。配对模式目前不向 `dsh-evolve-attention` 暴露未选定
Workspace 的通知 route；需要提醒桥接时使用静态 route 模式。

## V5.141：Gateway 配对码控件改为通用 Adapter 入口（本轮）

复核发现原生 Gateway Control Surface 的配对码输入仍硬编码调用 `feishu`，导致 Telegram-only Host 只能使用
pending request 行，不能复用同一 Host code 审批入口。本轮改为从当前 Gateway transport/pending projection 生成排序后的
Adapter 选择器，调用现有 `approvePairing(code, adapter, workspace, session)`；单页、脱敏、Host 权威和 request-id
路径保持不变。Telegram-only 与双 Adapter 的组件回归覆盖了选择器和正确 Adapter 传参，空 pending 时不再显示误导性
空卡片；完整 alpha.5 `pnpm run check` 退出码 `0`。未新增 Router、状态库、页面或运行时外部能力获取。详见
[V5.141 证据](evidence/v5-141-gateway-generic-pairing-2026-09-04.zh.md)。

## V5.142：原生 Control Center 单页浏览器复核仍受 Host 不可用阻断（本轮）

在不新开网页的前提下接管当前 DSH Local Build 页面，点击原生 `控制台 → 渠道`，确认同一 Control Center
complementary 与单一 `渠道` tabpanel 存在，未出现独立渠道窗口或固定弹窗。但当前页面的 DSH Host Remote 不可用，
Surface 停在错误提示/加载状态；浏览器随后拒绝本地页面刷新。该轮只证明单页挂载和点击路径，不能证明最新 Bundle
的 Remote、通用 Adapter 选择器或恢复交互通过；`web-control-plane` 保持 `partial`。详见
[V5.142 证据](evidence/v5-142-control-surface-browser-retry-2026-09-04.zh.md)。

## V5.143：Gateway 首次连接旅程改为通用 Adapter 投影（本轮）

修复 Gateway Control Surface 仍固定显示“飞书首次连接进度”的可视化偏差。现在旅程从当前 Adapter 的 transport、
pending 和 route 权威投影生成，Telegram-only 与双渠道页面共享连接、用户私聊、管理员批准三阶段；配对码入口和
空 pending 卡片策略与同一 Adapter 列表保持一致。Gateway Surface `9/9`、类型/构建与完整 alpha.5 `pnpm run check`
退出码 `0`。详见 [V5.143 证据](evidence/v5-143-gateway-generic-journey-2026-09-04.zh.md)。

## V5.134：同 route id 重配与聊天类型变更回归（本轮）

配对装配测试现在复用已撤销的同一 route id，并以 `group` chat kind 再次入站，确认撤销时清除内部观测、不会继承旧 direct 事实或触发漂移拒绝；类型检查、Gateway 构建和回归 `1/1` 通过。详见 [V5.134 证据](evidence/v5-134-feishu-route-id-repair-regression-2026-09-04.zh.md)。

## V5.133：撤销配对时清除飞书内部观测（本轮）

撤销动态 route 时同步删除 `observedChatKinds` 内部记录，避免同一 route id 重新配对后把旧 direct/group 事实误判为聊天类型漂移。类型检查、Gateway 构建和配对装配回归 `1/1` 通过。详见 [V5.133 证据](evidence/v5-133-feishu-revoked-observation-cleanup-2026-09-04.zh.md)。

## V5.132：撤销后的飞书只读观测同步（本轮）

动态配对 route 撤销后，`observedChatKind` 不再返回旧的 direct/group 观测，和 routes、health、notify、inbound 共同以 Gateway 当前 route 为权威。类型检查、Gateway 构建和配对装配回归 `1/1` 通过。详见 [V5.132 证据](evidence/v5-132-feishu-revoked-observation-reconciliation-2026-09-04.zh.md)。

## V5.131：飞书撤销修复后的 alpha.5 全仓回归（本轮）

在最新 DSH fetch/clean 审计后，使用已记录的 alpha.5 支持 checkout 执行 `DSH_EVOLVE_DSH_SOURCE_DIR=... pnpm run check`：文档、CI、套件/发布合同、12 包 typecheck、全部测试和全部构建通过，Feishu `18/46`、Gateway `8/40`、Telegram `8/29`，工作树 clean。该回归不改变最新 DSH master 上游构建阻断或真实渠道/Provider/Hermes/长期/npm 发布门状态。详见 [V5.131 证据](evidence/v5-131-alpha5-full-check-after-feishu-revoke-2026-09-04.zh.md)。

## V5.130：用户文档批准入口纠偏（本轮）

根 README 的飞书步骤已删除不存在的“Host 侧 request-id 命令”说法，改为说明管理员在同一个 DSH Web `Channels` Surface 的 pending 行直接批准脱敏 request-id。运行时没有新增命令或第二入口；文档、发布结构和差异检查通过。详见 [V5.130 证据](evidence/v5-130-user-doc-host-approval-clarification-2026-09-04.zh.md)。

## V5.129：飞书撤销配对路由权威同步（本轮）

修复 `dsh-feishu` 动态配对 route 的本地缓存不会随 Gateway Host 撤销而消失的问题。Host 路由列表、健康快照、通知和入站入口现在都会以 Gateway 当前 route 为权威；撤销后旧 route 被移除、通知 fail closed，DSH 原生 Agent/Session 保留，下一条陌生私聊重新走配对码。最新 DSH clean preflight、`dsh-gateway` 构建和 Feishu 配对装配回归 `1/1` 通过。详见 [V5.129 证据](evidence/v5-129-feishu-revoked-route-reconciliation-2026-09-04.zh.md)。

这只修复撤销/重配对的一致性，不改变真实 Feishu AS-2、独立 Provider、Hermes paired、长期效果或 npm 命名空间发布门的状态。

## V5.102：最新 DSH master 官方构建阻断复核（本轮）

重新 fetch 后，DSH checkout 已与 `origin/master`
`76fda729799fe9b3848dbe2c211d4b231032b81e` 对齐且 clean。直接运行官方 `pnpm build` 严格失败于 DSH 自身
`build:lib:host` 的 tsdown 入口解析：`[@deepseek-ai/dsh-root] Cannot find entry:
["lib/types/{index,invariant,startup}.js"]`。失败没有修改 DSH 工作树，也没有修改上游源码；详见
[V5.102 证据](evidence/v5-102-latest-dsh-build-blocker-2026-09-04.zh.md)。

因此最新 master 继续作为“已 fetch、已审计但不可 assembled 运行”的上游观察目标；EvoForge 的可构建支持矩阵仍
锁定 alpha.5 `db6bdc…`。本事实不冒充插件失败，也不改变真实渠道、双 Provider、Hermes paired、长期效果或
发布 tag 门禁。

## V5.122：内容寻址发布边界语义清理（本轮）

活动源码中 `VerifiedEvolutionStore` 的注释仍使用已删除的 Git tree 语义。本轮改为准确描述当前
`GenerationBundleRepository` 的内容寻址 Skill Bundle 校验；Generation store `10/10`、`check:docs` 和差异检查
通过，未改变运行时或 DSH 上游。详见 [V5.122 证据](evidence/v5-122-content-addressed-release-comment-cleanup-2026-09-04.zh.md)。

## V5.123：Hermes EV-1 当前 alpha.5 新 epoch（本轮）

在当前可构建 DSH alpha.5 `db6bdc…` 上建立独立 EV-1 epoch-2，旧 `47f9438` epoch-1 结果未改写。确定性
修正控制对照实际通过：校准 `2/2`，EvoForge 活动 Skill 提前修改指标 `0`，Hermes 原地修改指标 `1`；当前
Session 固定、未来 Session 晋升、跨 Workspace fail-closed、回滚/重启状态均通过。详见
[V5.123 证据](evidence/v5-123-hermes-ev1-alpha5-epoch-2-2026-09-04.zh.md)。这不是模型质量、真实渠道或完整
Hermes paired 证据，发布门仍保持阻断。

## V5.124：Goal 提示词与 Host 配对权威对齐（本轮）

复核可复制的 `codex goal` 提示词与当前实现后，删除“宿主 CLI 已可用”的不实承诺，明确管理员从原生 DSH Web
的 pending 列表批准，配对永远不回到 Session Command；未来若增加独立宿主管理命令，也只能复用同一 Gateway
Host authority。运行时未改动；文档链接、差异检查和 release-gate 结构检查随后通过。

## V5.125：Hermes 验收表同步当前 EV-1 epoch（本轮）

将当前 alpha.5 EV-1 epoch-2 的独立结果补入 Hermes replacement scorecard 与原始 paired-benchmark 页面，保留
epoch-1 冻结结果不变。两页都明确该结果只支持确定性 Skill 发布控制面的窄结论，不提升模型质量、真实渠道、长期
效果或整体上位替代状态。

## V5.126：最新 DSH 审计固化到开源流程（本轮）

将“每次开发/测试先 fetch 最新 DSH，核对 `HEAD == origin/master`、版本/tag、依赖与 clean worktree”写入
`CONTRIBUTING.md` 与发布纪律。最新 master 若自身不可构建，必须保留上游失败证据并使用已审计支持基线，不能
修改 DSH、静默回退或混淆插件结果。运行时未改。

## V5.127：Goal 提示词预算与边界自动检查（本轮）

在 `check-docs` 增加可复制 Goal 提示词守护：最终 `text` 块必须存在、总长度不超过 2000 字符，必须要求自主
继续，并禁止承诺不存在的宿主 CLI。这样后续文档编辑不会重新引入入口或预算漂移；运行时未改。

## V5.128：alpha.5 EV-1 复现入口显式化（本轮）

新增 `pnpm benchmark:hermes:ev1:alpha5`，固定使用当前 alpha.5 manifest/result；开发文档同时保留历史四个
epoch 的兼容入口并明确两者不可互相替代。新入口仍要求 `DSH_EVOLVE_DSH_SOURCE_DIR` 指向 exact alpha.5，
revision 或冻结结果漂移会 fail closed。

## V5.104：npm 包名归属审计与发布阻断（本轮）

在再次 fetch 并确认最新 DSH `origin/master` 为 `76fda729…`、工作树 clean 后，查询所有公开 Bundle 的 npm
registry 状态。`dsh-doctor`、`dsh-feishu`、`dsh-gateway`、`dsh-telegram` 已分别属于其他公开仓库，不能安全
发布；其余八个名称虽返回 `E404`，也尚未取得项目所有权。详见 [V5.104 证据](evidence/v5-104-npm-package-name-collision-2026-09-04.zh.md)。

本轮新增 `pnpm run check:release:names`，发布工作流在构建和 `npm publish` 前执行；冲突、无归属或 registry
异常均 fail closed，并在 `release-gates.json` 增加 required gate `registry-name-availability`（当前
`failed`）。没有未经授权地猜测 npm Scope 或静默重命名，首个公开 tag 继续阻止，直到完成命名空间决策并对
内部依赖、Bundle 清单、安装/卸载文档和完整矩阵重新验证。逻辑 Bundle id 与 npm 分发名的迁移边界见
[ADR-0101](adr/0101-public-package-namespace-before-npm-release.md)。

## V5.105：运行时自我发现边界纠偏（本轮）

审计路线图和可复制 Goal 提示词发现“找到候选/外部资料作为缺口来源”的歧义。本轮明确运行时自我发现只消费
DSH 内部已安装能力、Goal、真实反馈和结果；外部生态与论文只用于开发期设计调研和冻结 benchmark，禁止运行时
搜索、下载、导入或安装外部 Skill/能力。路线图、Goal 提示词和本证据已同步，`check:docs` 与差异检查通过；未
新增市场、Runtime、Router 或状态库。详见 [V5.105 证据](evidence/v5-105-runtime-self-discovery-boundary-2026-09-04.zh.md)。

## V5.107：发布预检与 scoped npm 名称解耦（本轮）

审计发现 `check-release.mjs` 以 `manifest.name` 拼接本地目录；未来迁移到合法 npm Scope 后会错误找不到
`packages/@scope/...`。本轮改为按 workspace 实际目录读取 manifest，同时保留公共元数据和 Bundle patch 校验。
最新 DSH preflight、文档/CI/套件/发布合同、全量 alpha.5 `pnpm run check` 均通过；未改名、未改 DSH、未绕过
npm 归属门。详见 [V5.107 证据](evidence/v5-107-release-check-scoped-name-safety-2026-09-04.zh.md)。

## V5.108：本地 release tag 接入 npm 名称实时门（本轮）

审计发现 GitHub release workflow 已检查 npm 包名，但本地 `release:tag` 路径没有实时检查。本轮在本地 tag
创建流程中、release gates 之前调用 `check-npm-package-names.mjs`，并增加脚本顺序回归；冲突、无归属或 registry
异常均 fail closed。CI 与本地发布路径现在一致，实际四个 npm 冲突仍阻止首个 tag。详见
[V5.108 证据](evidence/v5-108-local-tag-npm-preflight-2026-09-04.zh.md)。

## V5.109：套件打包分离 workspace 与公开 npm 身份（本轮）

继续审计命名空间迁移路径时发现，`pack-suites.mjs` 仍用 workspace 目录名推导 tarball 和卸载身份；取得项目拥有的
npm Scope 后会与 package manifest 名称分叉。本轮改为同时记录 `dir`、manifest `name` 和由公开名称推导的
`filename`，保持 DSH Bundle row 身份不变。core 套件真实打包、套件脚本测试和文档检查均通过；当前四个 npm 冲突及
命名空间授权仍是首个 tag 的硬阻塞。详见 [V5.109 证据](evidence/v5-109-suite-pack-public-name-boundary-2026-09-04.zh.md)。

## V5.110：npm 仓库归属 URL 规范化（本轮）

进一步审计真实 registry 归属判定时发现，同一 GitHub 仓库的 `git+https`、HTTPS 和 SSH 表示会被精确字符串比较
误判为 collision。本轮只对 GitHub owner/repository 路径做严格规范化，保留不同 host/路径和解析异常的 fail-closed
行为；6 个分类测试与文档检查通过。现有四个外部包名冲突和命名空间授权仍阻塞首个 tag。详见
[V5.110 证据](evidence/v5-110-npm-repository-url-normalization-2026-09-04.zh.md)。

## V5.111：core clean-profile 生命周期回归（本轮）

在最新 DSH fetch/clean preflight 后，使用已审计可构建 alpha.5 重新执行最终 tarball 的真实 DSH
`add/dump/boot/Session+Goal/dispose/remove/readback` 测试；1/1 通过（约 30.23 秒）。确认 V5.109 的套件身份
修正未破坏原生安装、卸载或持久化恢复；真实 Feishu、Provider、Hermes paired、长期效果和 npm 归属门仍保持原状态。
详见 [V5.111 证据](evidence/v5-111-clean-profile-core-install-2026-09-04.zh.md)。

## V5.113：Generation cache 跨进程恢复验证（本轮）

补充真实重启语义验证：首次 materialize 带嵌套 `references/` 的 Skill Bundle 后，创建全新的
`GenerationBundleRepository` 实例再次读取同一内容寻址缓存；`candidate-publisher` 8/8 通过。该测试覆盖 owner marker、
只读目录/文件、清单和内容哈希校验，确认“当前进程可用”与“Host 重启后可恢复”不是同一条未经证明的假设。详见
[V5.113 证据](evidence/v5-113-generation-cache-restart-verification-2026-09-04.zh.md)。

## V5.114：真实飞书 AS-2 Loader 行冲突修复（本轮）

真实 AS-2 首次重跑在官方传输启动前暴露了验收 overlay 的配置错误：它把 DSH Web 已拥有的 `web-runtime` 放入
`insert`，Loader 报 `duplicate loader entry id`。本轮按 DSH 官方 patch 语义改为顶层同 `id` 完整替换，AS-2 类型检查
和安全契约 `10/10` 通过；重新尝试真实运行时因工作树尚未提交被 clean guard 拒绝，未读取凭据或发起平台请求。详见
[V5.114 证据](evidence/v5-114-feishu-as2-overlay-loader-row-fix-2026-09-04.zh.md)。真实 Feishu AS-2 仍未通过。

## V5.115：真实飞书 AS-2 官方传输启动但无配对请求（本轮）

V5.114 提交后，新的隔离 AS-2 已完成最终 Bundle 安装、profile dump 和官方 WebSocket/HTTP 传输启动；等待 120 秒
仍没有陌生飞书私聊，因此在 `awaiting-resident-pairing-request` 阶段 fail closed。没有 Agent、回复、配对、
Schedule、Approval 或外部副作用；该失败现场不复用，真实 Feishu AS-2 仍未通过。详见
[V5.115 证据](evidence/v5-115-feishu-as2-official-transport-no-pending-2026-09-04.zh.md)。

## V5.116：Feishu AS-2 overlay 修复后的 alpha.5 全量回归（本轮）

在 canonical DSH 最新 master fetch/clean preflight 后，使用 alpha.5 支持基线执行根级 `pnpm run check`，最终
`CHECK_RC=0`。文档/CI/套件/发布合同、兼容矩阵、Hermes/Provider/Feishu 验收合同、12 包 typecheck、全部测试和
构建均通过；AS-2 类型检查与安全契约 `10/10` 通过。该结果只证明本地工程回归，不改变真实 Feishu、Provider、
Hermes paired、长期效果、Telegram 和 npm 发布门禁。详见
[V5.116 证据](evidence/v5-116-alpha5-full-check-after-feishu-as2-fix-2026-09-04.zh.md)。

## V5.117：根 README 用户入口重写（本轮）

中英文根 README 已重写为面向安装者的用户手册：说明四个能力套件、从本地 tarball 安装、飞书 resident pairing、
统一单页 Web、卸载、限制与排障；维护者 revision/V5 流水账移回 `docs/`，所有未通过的真实门禁仍明确标注。
`check:docs` 与 `git diff --check` 通过。详见
[V5.117 证据](evidence/v5-117-user-readme-rewrite-2026-09-04.zh.md)。

## V5.118：Feishu AS-2 overlay 行替换回归契约（本轮）

为防止 V5.114 的 Loader 冲突回归，AS-2 合同新增静态结构门，锁定 `web-runtime` 必须按 id 顶层替换、不得放进
`insert`；类型检查和安全/输入/终态合同 `11/11` 通过。该检查不读取凭据、不连接飞书、不产生外部效果；真实
Feishu AS-2 仍需独立 run root 和真实私聊完成。详见
[V5.118 证据](evidence/v5-118-feishu-as2-overlay-regression-contract-2026-09-04.zh.md)。

## V5.119：自我发现文档边界措辞修正（本轮）

将 `dsh-evolve` README 中容易被误解为能力获取的 “background discovery” 改为 “internal evidence processing”，
明确缺口报告只启动 DSH 内部证据处理，不触发外部搜索、下载、导入或安装。`check:docs` 与差异检查通过，未改运行时。
详见 [V5.119 证据](evidence/v5-119-internal-gap-wording-2026-09-04.zh.md)。

## V5.120：README 套件示例可独立执行（本轮）

中英文根 README 的按需安装代码块现在自带 `PACK_ROOT` 默认值，单独复制也能生成和安装 tarball；`check:docs` 与
差异检查通过。该改动只改善用户文档，不改变运行时或发布门。详见
[V5.120 证据](evidence/v5-120-readme-standalone-pack-root-2026-09-04.zh.md)。

## V5.121：真实飞书 AS-2 长等待仍无配对请求（本轮）

在干净 V5.116 revision 上使用 900 秒窗口重新启动真实 AS-2；最终 Bundle/profile dump 和官方传输均 ready，但没有
陌生私聊事件，Gateway 未暴露 pending request，runner 在配对前 fail closed。无 Agent、消息或其他外部副作用；
V5.115 短窗口与本轮长窗口共同确认剩余阻塞是外部测试账号入站动作，真实 Feishu AS-2 仍未通过。详见
[V5.121 证据](evidence/v5-121-feishu-as2-long-wait-no-pending-2026-09-04.zh.md)。

## V5.103：渠道控制面轮询契约与用户文档对齐（本轮）

审计发现 `GatewaySurface` 为了让新配对请求在同一个 DSH Web 页面自动出现，实际每 5 秒读取一次 Host 脱敏
`pendingPairings()`；飞书 README 与开始使用文档却写成“没有浏览器后台轮询”。本轮修正文档，明确这只是 Host
pending projection 的低频只读轮询，不轮询平台消息、不探测凭据、不读取正文、不调用模型；轮询失败保留最后快照，
完整健康状态仍由打开页面或手动刷新读取。未改运行时、网页数量、Gateway 权威或状态存储；`check:docs` 与差异检查
通过。详见 [V5.103 证据](evidence/v5-103-channel-doc-contract-2026-09-04.zh.md)。

## V5.100：Control Center 鼠标命中层修复与真实单页复验（本轮）

重新 fetch 并确认 DSH 最新远端 `origin/master` 为 `76fda729…`、工作树 clean。真实 DSH 页面定位到“看得到但点不
进去”的根因：DSH 自己的左侧宽度拖拽层以 `z-index:8`、40px 命中区域覆盖了 Control Center 导航按钮。键盘方向键
仍然有效，因而此前单测和键盘证据无法发现这个鼠标命中问题。

`dsh-control-center` 现在让整个原生 `conversation.view` 根节点建立 `position:relative; z-index:9` 层叠上下文，越过
该 DSH sibling 拖拽层；只提高内部导航层级不足以解决外部 stacking context。浏览器夹具同时在
`WorkspaceRegistry` 解析前创建 test-owned workspace，clean overlay 不再因不存在路径失败。新增客户端契约断言锁定
命中层级。

在可构建的 DSH alpha.5 支持 profile（`db6bdc…`）中，真实浏览器仅保留一个标签，鼠标点击 `渠道`、`飞书内容`、
`演化` 均成功切换，`刷新状态` 可用，整页 reload 后控制台和渠道仍可恢复。Control Center typecheck、构建和 2 个
 测试文件/5 个测试通过。最新 DSH master 的已知上游 module-table 构建缺陷未被修改；真实 Feishu AS-2、Provider、
Hermes paired、长期效果和 release tag 门不因本修复改变。详见 [V5.100 证据](evidence/v5-100-control-center-mouse-hit-target-2026-09-04.zh.md)。

## V5.101：鼠标命中修复后的根级完整回归（本轮）

重新 fetch 并确认最新 DSH `origin/master` 为 `76fda729…`、工作树 clean 后，在已审计可构建的 alpha.5 支持基线
`db6bdc…` 运行 `DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5> pnpm run check`，exit 0。文档/CI/套件清单、发布与兼容性
合同、Hermes/Provider/Feishu 验收合同、12 个包类型检查、全部测试和全部构建均通过；Evolve 69/309、Gateway
8/40、Feishu 18/46、Telegram 8/29、Evolution Web 2/27、Doctor 5/40、Control Center 2/5。

该回归确认 Control Center 根层级修复与浏览器夹具 workspace 初始化没有引入工程回归，main 工作树保持 clean，未
创建分支或 release tag。它不提升真实 Feishu AS-2、外部 Telegram、真实 Provider、Hermes paired、长期效果或
首个 tag 门；详见 [V5.101 证据](evidence/v5-101-alpha5-full-check-after-hit-target-fix-2026-09-04.zh.md)。

## V5.94：飞书事件回调故障边界（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，收口官方飞书 SDK 事件回调的异步拒绝路径。
此前 `message` 与 `cardAction` 回调直接调用异步处理器；入站路由解析、内容物化或 Gateway 投递异常可能变成
SDK emitter 看到的未处理 Promise rejection，既不能稳定记录到现有 Gateway 健康投影，也可能影响常驻连接。
现在两类回调均经过 Host 侧有限故障边界：捕获异常、将 transport 标记为 `degraded`、写入脱敏错误时间并记录
可读日志；上报健康本身失败时也只记录警告，dispose 后的迟到事件不会重新写状态。没有新增 Gateway、Session、
队列、重试策略或页面。

类型检查、定向 teardown 回归（包含真实异步 message callback 不泄漏 rejection）和产物构建通过。完整
`dsh-feishu` 测试集在当前 alpha.5 支持基线仍有一个已有的 Schedule 崩溃夹具在 `READY` 标记前超时；移除本
增量后同样复现，故未将该套件宣称为全绿，详见 [V5.94 证据](evidence/v5-94-feishu-event-boundary-2026-09-04.zh.md)。
该增量改善常驻故障可观测性，不提升真实 Feishu AS-2、Provider、Hermes paired、长期效果或 release tag 门。

## V5.95：Schedule 崩溃恢复夹具对齐 alpha.5（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，修复 `dsh-feishu` 的跨进程 Schedule 崩溃恢复
夹具：alpha.5 已将持久化入口统一为 `persistBatch`，旧夹具却只替换了一个未被调用的 `appendBatch` 属性，且
一秒延迟会让启动期间的 dispatch 先于故障注入发生。夹具现在按实际方法名安装阻断、给连接启动留出五秒窗口，
仍真实验证“平台 effect 已产生但 dispatch checkpoint 未持久化”后的 SIGKILL 恢复去重；未改 DSH 上游源码，也
未跳过测试。

最新 alpha.5 支持基线下 `dsh-feishu` 全部 18 个测试文件、46/46 测试通过，产物构建通过。该修复恢复了
Schedule durability 证据的有效性，不提升真实 Feishu AS-2、Provider、Hermes paired、长期效果或 release tag 门。
详见 [V5.95 证据](evidence/v5-95-schedule-crash-fixture-alpha5-2026-09-04.zh.md)。

## V5.96：飞书边界后根级质量检查（本轮）

在再次 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…`、支持基线 alpha.5 clean 后，运行根级
`DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5> pnpm run check`。文档/CI/套件与发布合同、DSH 兼容性、Hermes/Provider/
Feishu 合同检查、12 个包的类型检查、所有测试和所有构建全部通过；其中 `dsh-feishu` 为 18/18 文件、46/46
测试，`dsh-telegram` 为 8/8 文件、29/29 测试，`dsh-gateway` 为 8/8 文件、40/40 测试。

这是当前 main 的可重复工程质量基线；真实 Feishu AS-2、双真实 Provider、Hermes paired、长期效果、真实外部
浏览器恢复和首个 release tag 仍未通过，未因根级绿灯而提前发布。详见
[V5.96 证据](evidence/v5-96-alpha5-full-check-2026-09-04.zh.md)。

## V5.97：真实 Feishu AS-2 最新隔离重试严格失败（本轮）

在 main `d6b9e56…` 快照上重新打包三件最终 Bundle，使用全新隔离 run root 和固定 alpha.5 启动真实
`dsh-gateway`/`dsh-feishu`。配置 dump 与官方飞书 WebSocket `ready` 均通过；15 分钟人工窗口内没有观察到
当前 App 的陌生私聊 pending request，因而没有批准 principal、没有 Agent 入站、没有平台回复或其他外部副作用。
运行器在 `awaiting-resident-pairing-request` 阶段 fail closed，旧 run 不复用；`real-feishu-as2` 门仍为
`failed`。详见 [V5.97 证据](evidence/v5-97-real-feishu-as2-no-pending-2026-09-04.zh.md)。

## V5.98：AS-2 非交互启动不再制造多 URL 噪声（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，收敛真实 AS-2 验收器的启动输出。验收器为创建
Workspace、正式连接和重启会多次 boot DSH Web；此前虽使用 `--no-open`，仍会把每个临时服务 URL 打到终端，
容易让用户误以为需要打开多个网页。现在仅在验收 overlay 中关闭 `web-runtime` 的 URL/浏览器/模型表面输出，
保留 DSH Web 服务作为原生 RPC 依赖；正式 DSH 用户路径仍只有一个 `conversation.view` 控制面。

AS-2 合同 10/10、类型检查和文档检查通过；没有新增页面、Router、Gateway、Session 或状态库，不改变真实
Feishu AS-2 的失败门禁。详见 [V5.98 证据](evidence/v5-98-as2-single-page-startup-output-2026-09-04.zh.md)。

## V5.99：AS-2 overlay 修复后的根级完整回归（本轮）

在再次 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…`、alpha.5 支持 checkout clean 后，重新运行根级
`DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5> pnpm run check`。文档、CI、套件清单、发布合同、兼容性检查、所有包的
类型检查、测试和构建全部通过；`dsh-evolve` 为 69 个文件/309 个测试，`dsh-gateway` 为 8/40，
`dsh-feishu` 为 18/46，`dsh-telegram` 为 8/29，`dsh-evolve-web` 为 2/27。V5.98 的非交互 AS-2 overlay
没有引入回归，详见 [V5.99 证据](evidence/v5-99-alpha5-full-check-after-as2-overlay-2026-09-04.zh.md)。

该绿灯只代表固定运行时上的工程质量；真实 Feishu AS-2、双真实 Provider、同模型 Hermes paired、长期效果、
真实浏览器完整恢复和首个 release tag 仍未通过，发布门状态不变。

## V5.88：Gateway 单页渠道入口按需显示（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，修复 Telegram-only profile 仍出现空“飞书配对”
表单和 pending 区块的问题。Gateway 原生单页现在仅在 Host 已观察到飞书 transport/route/request 时显示飞书
旅程；待处理区块也按事实出现，帮助文案优先管理员直接批准 request。Gateway Control Surface 6/6、文档检查和
类型检查通过；没有新增网页、Router、Session 或外部探测。该入口降噪不提升真实 Feishu、Telegram、Provider、
Hermes paired、长期效果或 release tag 门。详见 [V5.88 证据](evidence/v5-88-gateway-feishu-surface-gating-2026-09-04.zh.md)。

## V5.89：飞书 AS-2 epoch-4 最新隔离运行严格失败（本轮）

最新一次真实飞书 AS-2 使用干净 profile、最终三包和 alpha.5 支持基线完成安装、配置 dump，并确认官方
WebSocket 达到 `ready`；15 分钟人工窗口内没有收到与当前 App 身份匹配的新陌生私聊，因而没有 pending
pairing request，运行在配对前 fail closed。没有批准 principal、Agent 入站或外部副作用；`real-feishu-as2`
继续保持 `failed`，下一次必须使用全新隔离 run root。详见
[V5.89 证据](evidence/v5-89-feishu-as2-epoch4-no-pending-2026-09-04.zh.md)。

## V5.90：Control Center 多挂载 ARIA 标识隔离（本轮）

统一原生 `conversation.view` 控制面不再使用跨挂载的固定 tab/panel DOM id。每个 React view 实例现在拥有
独立的 ARIA 标识，DSH 切换 Session 或恢复时即使短暂存在多个 view，也不会让键盘/读屏关系串到其他 Session。
最新 DSH revision 下类型检查、Control Center 定向 5/5 测试和产物构建通过；没有新增网页、Router、Session
或状态库。详见 [V5.90 证据](evidence/v5-90-control-center-instance-aria-ids-2026-09-04.zh.md)。

## V5.91：飞书资源下载绑定取消信号（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，修复资源下载只检查 signal 却没有让官方 SDK
网络请求继承 signal 的生命周期缺口。Gateway 停止、Session 取消或 Adapter dispose 时，图片/文件请求现在
和其他飞书 HTTP 调用一样可被中断；大小上限、流式校验和错误语义不变。`dsh-feishu` 类型检查及平台/图片
定向 8/8 测试通过。该增量改善清理可靠性，不提升真实 Feishu AS-2、Provider、Hermes paired、长期效果或
release tag 门。详见 [V5.91 证据](evidence/v5-91-feishu-download-abort-signal-2026-09-04.zh.md)。

## V5.92：Gateway 配对表单多挂载标识隔离（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，补齐统一控制面另一处多挂载可访问性缺口：
Gateway 配对码输入框原先使用固定 DOM id，DSH 在 Session 切换或恢复时若短暂挂载多个 Gateway Surface，
`label` 可能指向另一个 Session 的输入框。现在每个 Surface 使用 React `useId()` 生成实例化配对码 id，
同时保持单页、原生 slot、Host 权威状态和现有配对流程不变。新增双 Surface 回归测试，类型检查和定向 7/7
测试通过；该修复不提升真实 Feishu AS-2、Provider、Hermes paired、长期效果或 release tag 门。详见
[V5.92 证据](evidence/v5-92-gateway-pairing-aria-isolation-2026-09-04.zh.md)。

## V5.93：Gateway 会话切换清空旧快照（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，修复 Gateway Surface 刷新 effect 只依赖
`remote` 的会话隔离缺口。DSH 复用同一个 Surface 切换 Workspace/Session 时，现在会取消旧请求、清空旧渠道
快照和配对状态，再读取新 Session 的 Host 权威状态；旧请求即使晚到也不能覆盖新状态。新增切换期间加载态与
新快照回归测试，Gateway 类型检查、定向 8/8 测试和产物构建通过；不新增页面、Router、Session、状态库或
运行时。该修复不提升真实 Feishu AS-2、Provider、Hermes paired、长期效果或 release tag 门。详见
[V5.93 证据](evidence/v5-93-gateway-session-switch-isolation-2026-09-04.zh.md)。

## V5.87：飞书策略拒绝可观测性（本轮）

重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，为官方 Node SDK 的 `reject` 事件接入已有
Gateway 健康投影：同一个原生 Control Center 技术详情现在能区分“事件已到达但被安全策略拒绝”和“连接从未
收到平台事件”。只记录官方 reason 与时间，不暴露消息/聊天/发送者标识；策略拒绝不改变 transport 的
`ready`/`degraded` 生命周期。Feishu 类型检查、健康/平台定向 8/8 测试通过；完整发布门仍保持真实 AS-2、
双 Provider、Hermes paired、长期效果和首个 tag 未通过。完整实现和命令见
[V5.87 证据](evidence/v5-87-feishu-policy-reject-observability-2026-09-04.zh.md)。

## V5.84：alpha.5 支持基线完整检查收口（本轮）

在重新 fetch 并确认 DSH 最新远端 `master` 为 `76fda729…` 后，本轮用已构建的 alpha.5 支持基线
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 执行根级 `DSH_EVOLVE_DSH_SOURCE_DIR=... pnpm run check`。
命令退出码为 0：文档/CI/套件/发布结构、兼容性与合同门、12 包 typecheck、全包测试和全包 build 均通过；
Evolve 309、Gateway 37、Feishu 45、Telegram 29、Evolution Web 26、Doctor 40 等关键计数见
[V5.84 证据](evidence/v5-84-alpha5-full-check-2026-09-04.zh.md)。其中只有已有平台/历史夹具的显式 skip，
不把 skip 改写成通过。该结果收口本地工程质量，不提升真实 Feishu、双 Provider、Hermes paired、长期效果
或 release tag 门禁。

## V5.85：完整检查 DSH preflight（本轮）

根级 `pnpm run check` 现在先要求显式 `DSH_EVOLVE_DSH_SOURCE_DIR`，并立即校验 DSH exact revision、版本与
clean worktree；缺失或错配会在长测试前失败并给出修复命令，不再回退到相邻 checkout。静态套件含新增合同
测试 5/5 通过，使用 alpha.5 支持基线的完整 check 也通过；详见 [V5.85 证据](evidence/v5-85-dsh-preflight-2026-09-04.zh.md)。
该修正改善贡献者反馈，不扩大 DSH 支持范围，也不改变真实渠道、Provider、Hermes paired、长期效果或 release
tag 门禁。

## V5.86：清理旧 Evolution 固定弹层（本轮）

重新审计发现，虽然活动入口已经迁入 DSH 原生 `conversation.view`，`dsh-evolve-web` 的兼容导出仍保留旧的
固定 `dsh-evolve-panel` 和确认遮罩样式。这与单页控制面约束冲突，也给第三方嵌入者留下第二套浮层入口。
本轮保留源码兼容导出，但将其改为文档流中的 `dsh-evolve-inline`，删除固定定位及旧 backdrop，并加入负向
package contract 防回归。alpha.5 支持基线下文档、CI、套件、Evolution Web 27/27、全量 typecheck、测试和
build 均通过。完整变更、命令和边界见 [V5.86 证据](evidence/v5-86-remove-stale-evolution-overlay-2026-09-04.zh.md)。
这是单页边界清理，不提升真实 Feishu、Provider、Hermes paired、长期效果或 release tag 门禁。

## V5.83：渠道首次连接导引与单页浏览器验收（本轮）

Control Center 现在提供共享的三段式首次连接导引：常驻连接、用户私聊、管理员批准。它只由 Gateway 脱敏
transport/pending/route 事实驱动，Telegram-only 安装不会显示飞书入口；旧 Adapter 没有新控件时仍可运行。
新增的 Gateway overlay 生成器把测试 fixture 放到包目录外，并使用 `pairedRoutes`，避免随机 Workspace id
污染 patch。最新已审计 DSH alpha.5 隔离 profile 的单页浏览器实测已在原生“控制台 → 渠道”看到导引，刷新后同一
Session 和状态恢复，始终只有一个页面。详见 [V5.83 证据](evidence/v5-83-channel-journey-single-page-browser-2026-09-04.zh.md)。
该证据已加入根目录 `release-gates.json` 的 `web-control-plane` 索引；本轮不提升真实渠道、Provider、Hermes
paired 或长期效果门。

## V5.82：用户文档与发布门禁证据一致性审计（本轮）

重新检查用户会直接阅读的 `dsh-feishu` README、根 README、状态页和最新浏览器证据后，修正了飞书 README
中遗留的 epoch-2/“当前无凭据、NOT_RUN”表述，并改为当前 epoch-4 的真实结果：最近一次隔离运行确实达到
官方 WebSocket `ready`，但人工窗口没有收到匹配的陌生私聊，因而在配对前严格失败闭合。浏览器证据中把
错误的 `docs/evidence/release-gates.json` 路径改为根目录 `release-gates.json`，避免用户按错误路径复核。
本轮没有把合同测试或 WebSocket ready 提升为真实飞书通过，也没有改变任何运行时实现或发布门状态。

## V5.81：最新 DSH 单页浏览器验收与入口身份修复（本轮）

最新 DSH alpha.5 Web 验收曾因 overlay 直接加载包内 fixture，被 DSH 的最近 `package.json` client 身份解析器
误判为第二个 `dsh-control-center` source。两个浏览器 overlay 现都生成包目录外的临时 ESM shim；shim 只转出
fixture 的标准 Loader 导出，不进入最终 Bundle。重新 fetch 并确认最新 DSH `origin/master`
`76fda729…` 后，在隔离 profile 安装 `core + channels/telegram`，用单个 `3080` Host 和单个浏览器页面验证了真实
workspace/session 选择、原生“控制台”、Doctor 重新诊断、ARIA 键盘切换到 Evolution，以及整页 reload 恢复。
页面全程没有第二标签、独立路由或固定弹窗；Host 已在验证结束停止。完整命令、截图观察和边界见
[V5.81 证据](evidence/v5-81-browser-overlay-package-identity-2026-09-03.zh.md)。

该修复只提高浏览器验收 harness 的可重复性，不改变真实渠道、Provider、Hermes paired 或长期效果门；项目仍
处于 `pre-alpha`，不创建 release tag。

## V5.69：DSH alpha.5 迁移收口（本轮）

本轮开发和测试固定在 DSH `0.1.2-alpha.5`。本地最新 `master` 为
`49a606bc5b5934603f22a26957a07dc799ab0291`；最新公开 tag
`dsh-v0.1.2-alpha.5` 为 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。EvoForge 已迁移到
alpha.5 的 `ToolCallId`、`JsonValue`、`snapshotEvents()`、`SessionPersistence` 的
`prepare/load/inspect` API 与 JSONL coordinator 接缝、
`SessionProjectionRegistry.restore` 和 Cordis 4.0.2 接缝。typecheck、核心包测试、assembled
Skill/Completion/Crash Recovery 以及 clean-profile add/dump/boot/reload/dispose/remove/readback
均通过；历史 pre-alpha.5 suite-upgrade 夹具明确 skip，不把旧 `CallId` 导入失败伪装成升级成功。

最新 DSH master 的安装通过，但其 Client bundle 构建暴露上游 `session-persistence` 导出缺失；
本项目不改上游，assembled 证据使用同版本最新公开 tag，并在该 tag 上先完成完整构建再跑测试。
本轮 alpha5 全套本地结果为：Evolve 309、Gateway 36、Feishu 45、Telegram 29、Software Delivery
35（另 2 个历史/平台夹具明确 skipped），Goal Continuity 12、Doctor 40、Control Center 4。
完整 revision、命令和失败修复过程见 [alpha.5 迁移审计](research/dsh-alpha5-migration-audit-2026-09-03.zh.md)与
[V5.69 证据](evidence/v5-69-dsh-alpha5-migration-2026-09-03.zh.md)。

## V5.71：渠道套件统一单页控制面（本轮）

重新审计发现 `channels` 只安装 Gateway/Adapter 时，README 虽要求管理员在 DSH Web 批准配对，但该 profile
实际上没有安装 Control Center。已修正套件清单：`channels` 及 `--channel feishu|telegram` 现在随附轻量
`dsh-control-center`，仍不包含 `dsh-evolve`、`dsh-evolve-web` 或 `attention`，因此没有增加自我进化或通知冗余。
AS-2 最终包同步安装并卸载 Control Center。基于最新可复现 alpha.5 clean profile 的真实单页浏览器验证已通过：
在一个 DSH Web 标签中进入原生 Session“控制台 → 渠道”，看到 Gateway/飞书 Surface，点击刷新并整页 reload
后仍可操作，没有打开第二网页或固定遮挡弹窗。证据见 [V5.71](evidence/v5-71-channel-suite-control-center-and-real-run-2026-09-03.zh.md)。

同一轮真实 Feishu AS-2 已到达官方 WebSocket ready，但人工等待窗口没有新的陌生私聊，严格停在
`awaiting-resident-pairing-request` 并失败；没有批准 principal、进入 Agent 或产生任何外部效果。该结果不提升
真实飞书、Provider、Hermes paired 或长期门，下一轮必须使用新的隔离 run root 重跑完整 AS-2。

当前仍是 `pre-alpha`，不能发布首个 tag：真实飞书完整 AS-2、两套真实 provider、同条件 Hermes
paired benchmark、长期负迁移/遗忘和完整真实浏览器成功/失败/恢复门尚未齐备。README 已改为用户指南，
内部过程和历史证据只放在 `docs/`。

## V5.72：最新 DSH master 复核（本轮）

按持续开发纪律，本轮在任何后续测试前重新执行了 DSH `git fetch origin --tags`，确认工作树 clean，当前远端
`master` 为 `76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1-99-g76fda72979`），公开 tag
`dsh-v0.1.2-rc.1` 为 `a66e4702047846cdaa10c66c9d3df3951f5ea70d`。两者安装依赖均通过，但从干净 checkout
运行根级 `pnpm build` 都在上游 `@deepseek-ai/dsh-root` 缺少
`lib/types/{index,invariant,startup}.js` 入口处失败；该问题未由 EvoForge 修改或掩盖。因而本轮所有可执行
assembled/clean-profile 证据继续锁定已完整构建的 `dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，并将
tag、master、可构建基线三者分开记录。该复核没有扩大支持声明，也没有把上游失败误报为插件故障。
完整命令、输出和支持决策见 [V5.72 证据](evidence/v5-72-latest-dsh-master-reaudit-2026-09-03.zh.md)。

## V5.73：物理 Bundle 边界与用户入口审计（本轮）

逐包复核了当前 12 个 Bundle 的生命周期、权限、外部依赖和状态所有权。没有发现可以安全合并而不破坏
DSH 原生卸载、最小权限或信任域的包；因此不做目录级删减，而是把用户入口固定为 `core`、`channels`、
`delivery`、`continuity` 四个套件，`attention` 作为显式可选附加能力，其余仅为兼容/维护者入口。旧
`dsh-channel-router`、ClawHub/市场获取、重复状态库和旧 Web 表面继续保持物理删除。审计表与安装决策见
[插件边界审计](audits/2026-09-03-package-boundary-audit.zh.md)。

## V5.74：真实飞书 AS-2 epoch-4 最新隔离重试严格失败（本轮）

epoch-4 合同的最新隔离 AS-2 重试使用 EvoForge `026a0e0…` 与 DSH alpha.5 `db6bdc…`，三包最终产物安装、profile dump 和
官方 WebSocket ready 均通过；15 分钟人工窗口内没有收到与当前 App 身份匹配的 pending pairing request，
因此在 `awaiting-resident-pairing-request` fail closed。没有批准 principal、进入 Agent 或产生外部副作用，
所有后续 direct message、Command、Schedule、Approval、重启、卸载和 readback 观察值均为 false。详见
[V5.74 证据](evidence/v5-74-feishu-as2-epoch5-no-event-2026-09-03.zh.md)；`real-feishu-as2` 仍保持 failed。

## V5.76：飞书入站事件可观测性（本轮）

健康投影新增 `transport.lastInboundAt`，与 `lastActivityAt` 分离；同一原生 Control Center 技术详情现在能
明确区分“WebSocket 已连接”和“确实收到平台事件”。字段只由真实消息/Approval 回调更新，不探测平台权限、
不读取凭据、不改变路由。alpha.5 基线下针对性健康契约 3/3 通过，完整 Feishu 套件保持 45/45；真实 AS-2
仍因没有 pending pairing 事件而严格失败。详见 [V5.76 证据](evidence/v5-76-feishu-inbound-observation-2026-09-03.zh.md)。

## V5.77：统一 Gateway 入站事件可观测性（本轮）

将 `lastInboundAt` 下沉为统一 Gateway transport observation，Feishu 与 Telegram Adapter 都报告真实入站
事件，单页“渠道与网关”技术详情直接显示该时间；连接、出站和入站活动不再混为一谈。重新生成的 Gateway
Typert artifacts、Gateway 36/36、Telegram 29/29 均通过 alpha.5 基线验证。该增量不改变路由、配对、投递或
任何发布门；真实 Feishu AS-2 仍需事件到达。详见 [V5.77 证据](evidence/v5-77-gateway-inbound-observation-2026-09-03.zh.md)。

## V5.78：飞书 WebSocket 重连健康投影（本轮）

飞书 Adapter 现在接收官方 Node SDK 的 `reconnecting`/`reconnected` 生命周期：重连期间把现有 Gateway
transport 标为 `degraded`，恢复后无重启回到 `ready`。这是同一个 resident Host、同一个 Gateway 注册和同一
原生控制面上的状态更新，没有新增 Router、后台 Runtime、探测请求或模型调用；`lastInboundAt` 仍只由真实
消息/卡片事件更新。为兼容旧测试和替代平台，两个 hook 是可选的。运行时 teardown 测试已验证
`ready → degraded → ready` 且 Gateway 停止时仍会断开平台；本增量不提升真实 AS-2、Provider、Hermes
paired 或长期效果门。详见 [V5.78 证据](evidence/v5-78-feishu-reconnect-health-2026-09-03.zh.md)。

## V5.79：飞书入站时间转发收口（本轮）

补齐 V5.78 遗漏的公共投影接缝：`FeishuRuntime.reportTransport()` 现在把 Adapter 记录的
`lastInboundAt` 转发到同一个 Gateway transport registration。因此统一 `渠道与网关` 页面、Gateway
健康快照和 Feishu `/feishu` 健康命令不会再出现一个显示“收到事件”、另一个仍为空的分叉。assembled-chat
回归断言要求实际入站后公共 transport 的字段为时间戳；不改变路由、配对、投递或发布门。详见
[V5.79 证据](evidence/v5-79-feishu-inbound-projection-follow-through-2026-09-03.zh.md)。

## V5.80：真实飞书 AS-2 最新隔离重试（本轮）

再次执行 epoch-4 的真实飞书 resident pairing 合同：最终 Gateway/Feishu tarball 安装、profile dump 和
官方 WebSocket `ready` 均通过；15 分钟人工窗口仍未出现与当前 App 身份匹配的陌生私聊 pending request，
所以 runner 在 `awaiting-resident-pairing-request` fail closed，未批准 principal、未进入 Agent、未发送任何
后续外部效果。该 run 在 V5.78/V5.79 提交之前冻结于 `e7ab932…`，不能用来宣称重连或公共入站字段已在真实
平台验证；结果只强化“平台事件尚未到达”的事实。详见 [V5.80 证据](evidence/v5-80-feishu-as2-latest-isolated-retry-2026-09-03.zh.md)。

## V5.75：参考生态当前 revision 复核（本轮）

为下一次 Hermes paired 和设计校准重新读取公开远端：Hermes Agent `63279301…`、OpenClaw `1fb3e0ca…`、
HanaAgent/openhanako `1d3ef308…`；公开 tag 与远端 HEAD 分开记录。该复核只更新设计期证据，不把任何外部
项目作为运行时依赖、Skill 来源、Provider 路由或发布门捷径。详见[当前 revision 复核](research/ecosystem-current-revision-2026-09-03.zh.md)。

## 状态词

| 状态 | 含义 |
|---|---|
| `planned` | 尚无可运行实现 |
| `implemented` | 源码和自动化测试存在，真实环境或发布证据仍不足 |
| `verified` | 对应退出门有可复核的真实证据 |
| `released` | 已发布并验证安装、升级和卸载 |

## 当前总判断

V5.68 修复了 macOS assembled `0.1.1-rc.2` CI 中 `dsh-telegram/dist/index.mjs` 的共享构建竞态：
`dsh-evolve-attention` 的 peer `prebuild` 与工作流重复直接构建 Telegram，`tsdown clean` 会造成偶发缺模块。
本地 `check:ci` 已通过，远端矩阵仍需复跑；这只是 CI 可靠性修复，不提升真实 Feishu、真实 Provider、Hermes
paired 或长期效果门。证据见 [V5.68](evidence/v5-68-ci-telegram-build-race-2026-09-02.zh.md)。

本地仓库已收口为标准仓库路径下唯一 `main` 工作树和本地分支，并与 `origin/main` 同步。

EvoForge 已有大量 `implemented` 能力，但 v0.1 **未完成**。所有已提交成果都在权威 `main`；`dsh-gateway` 已直接替换 `dsh-channel-router`。ClawHub、市场和 runtime research Candidate 已删除；`dsh-evolve` 的 Git source/ref、预选 Skill、静态 Case Pack/Feedback/Evaluator target、Feedback/Evaluator Draft、Shadow 内 proposer、自动 review expiry、旧 Retention/canary 和对应 Control/Web/attention 表面也已从活动源码物理删除。公开 Config 只包含内容寻址缓存、Workspace 自发现/评测 policy 和通用 supervisor；`GenerationBundleRepository`/`CandidatePublisher` 只解析内部 whole-Skill Bundle，legacy artifact 明确 quarantine；packed artifact 与 Shadow 源码均有负向回归契约。Gateway 的入站边界现支持文本和 DSH 原生图片引用；飞书外部图片 key 在 Adapter 内下载并经 AttachmentStore 内容寻址保存，不进入 Session。rc.2 与 rc.5 均已由当前代码重验通过，修复与结果见 [V5.29](evidence/v5-29-compatibility-rerun-2026-08-26.zh.md)；两版 AttachmentStore/ContentBlock 仍不支持通用文件，普通文件/音视频明确 pending。

当前 Candidate seam 只接受内部 Skill Opportunity 生成的 canonical text bundle。两个独立 Goal 形成 Opportunity；四个 Goal 预密封 authoring/admission/holdout，存在第五个或更多独立 Goal 时再保留一个 Candidate 不可见的 Retention 样本。Candidate v2、Lineage v3 与 exact seal 绑定；四 Goal路径保持 Envelope v4 并对 Retention abstain，带第五 Goal 时形成 Envelope v5，绑定独立 assembled Retention Case Pack 与 run root。真实 assembled baseline 不安装目标 Skill，Candidate 侧才安装 exact whole-Skill；Shadow 只消费同一 exact Candidate、内容哈希、tree、lineage 与 `dshAssembled` Trial，自身不调用 proposer。promotable Shadow 现会在同一个 DSH Jobs 任务内进入内容寻址 Retention paired Trial，持久写入 retained/regressed/incomplete，结果无发布权。独立 `FutureSessionPromotion` Host gate 重验 approved Review、Generation artifact、Lineage、Shadow 和 Retention exact identity，只有结构完整的 retained verdict 才调用 Generation selection；missing/prepared 等待，warning、歧义、错配、regressed 和 incomplete 阻断。Command/Web 共用该 gate，Web 显示 eligible/waiting/blocked 与原因。失败 durable Outcome 现在会唤醒原生 DSH `evolution` Job；`CounterfactualCanary` 重验 exact active Generation 全谱系并复放其密封 Retention Case Pack，只写 `keep`/`review`/`rollback-eligible`。内容、pointer 或 composition 漂移、baseline/calibration 失败、歧义和中断均 fail closed，已 dispatch 未见结果不盲重试，Canary 没有 pointer 写接口。独立 `FutureSessionRollback` Host gate 现区分显式人工恢复与 exact Canary 证据动作，两者均在 Store 串行写临界区执行 expected-active compare；Command、Remote、Web 已删除直接 Store 旁路，既有 Session pin 不变。经复核的新 Skill 可形成内容寻址 inactive Generation，真实 DSH 已验证 future-Session-only、重启固定和 root rollback；V4.48 与 V4.49 已分别完成 existing-Skill 与 missing-Skill Canary/rollback 的最终 tarball 浏览器故障恢复，两条路径的真实 provider 仍未完成。

Gateway 已统一 Telegram/飞书普通文本 outbound、幂等、限流、uncertain 恢复、transport observation 和健康快照；Web 已做真实浏览器读取/刷新/断连恢复。现有 Skill 的同版本跨 Goal 精确纠正先形成 investigation；V4.33–V4.40 依次完成完整调用时 baseline、同一基线资格、protected evidence seal、whole-tree Candidate、结构准入、Candidate-blind Holdout 治理与 exact paired Holdout，以及 Candidate 前独立 Retention Case Pack。V4.41 只从同一 Candidate 的权威 `improved` Holdout 触发 exact Retention；Host 重验 baseline/Candidate、Admission、Envelope、两套 Case Pack 和全部 assembled integrity gates，四 Goal零花费 abstain，五 Goal按四象限持久判定，付费结果未知不盲重试，结果无发布权。V4.42 已从最终 tarball 验证该 Retention 的真实 DSH Web 卡片、reload、Host 断连显式报错但保留最后快照、同端口恢复、console error 0 与官方卸载；V4.46–V4.47 已完成 existing-Skill failed-Outcome Canary、Control/Remote/Web 与独立 expected-active rollback gate；V4.48 已从最终 tarball 验证其 approve/promote/Canary/Host 断连保留/精确 rollback/整页及进程恢复/卸载；V4.49 已对 missing-Skill `skill-bundle` 完成同类 promote/Canary/root rollback 生命周期，两轮 console error 均为 0。V4.50–V4.51 已把 exact 跨 Goal Skill Use 与后续 durable Outcome、重复交付、恢复及最新 metrics 做成 Host 权威非因果视图，并完成最终包的刷新、失败保留、冷恢复和卸载。完整效果/返工/负迁移归因、真实飞书 exact 消息、两套独立真实 provider、Hermes paired 和长期数据仍未达标。

V5.24 为 resident pairing 增加动态 principal grant 的原子撤销墓碑与 DSH Web 两步确认。静态 route、活动
ingress/outbound effect 和 Session 删除均 fail closed；最终 Gateway tarball 已在真实 rc.2 profile 原位升级并
冷启动，现有动态 grant、原生 Session、3/3 journal 与 ready WebSocket 均恢复。真实 direct 文本、原生
Command 和回复已经通过；实际撤销重配、Approval、Schedule、group、长期数据和 Hermes paired 仍未达标。

V5.25 修正默认 DSH checkout 更新到 rc.2 后的活动门漂移：五个示例 Case Pack 不再锁旧 rc.5，GitHub Review
测试 LLM 适配 `prepareCall()`，原生 Command 测试显式传空 images。Evolve 305 passed / 1 skipped，GitHub
Review 27/27；冻结 Hermes 结果和双版本 compatibility gate 没有改写。

V5.26 修正一次真实用户可见的验收偏差：`56017` 是已退出 clean-profile Host 留下的死页面，不是可交付
DSH。生命周期探针现在按目标 DSH CLI 能力自适应关闭浏览器（rc.2 传 `--no-open`，rc.5 使用其无浏览器
handoff 的 `--port` 契约）；复跑后真实 Chrome 只剩常驻 `3080`，并已实际点击/刷新 Gateway
控制面。飞书 Runtime 也修复 Gateway 先停止时 teardown 中断、平台不断连的竞态；确定性失败注入、30 次
assembled pairing 重复门及 Feishu 45/45 已通过。`cb7266b` 最终飞书 tarball 已用官方 CLI 升级当前
`web` profile；Host 重启后原 route/Session、ready WebSocket、3/3 journal 与零异常均恢复。

V5.27 把分散且遮挡 DSH 的 Gateway/飞书悬浮面板推翻为原生插件可视化平台：新增第十二个可卸载包
`dsh-control-center`，只占用一个官方 `conversation.view`，并以 Cordis child slot 接收插件 Surface；Gateway
与飞书作为两个真实 Adapter 复用同一组状态、指标、列表、错误和操作原语。固定 DSH/Turtle UI、Hermes、
HanaAgent 一手 revision 的设计调研、[ADR-0099](adr/0099-control-center-owns-one-native-view-and-child-surface-slot.md)、
十二包 clean-profile 安装/boot/remove/readback 与真实 Chrome 成功/刷新/断连保留/恢复证据见
[V5.27](evidence/v5-27-native-plugin-control-center.zh.md)。随后 [V5.28](evidence/v5-28-evolution-surface-control-center.zh.md)
把 `dsh-evolve-web` 迁入同一公共 Surface；旧侧栏固定弹窗不再是活动入口。迁移后的 Evolution 最终包真实
Evolution 迁移后的真实 Workspace/Session 浏览器验收已由 [V5.30](evidence/v5-30-evolution-surface-browser-2026-08-26.zh.md) 通过；Doctor/Telegram 迁入公共 Surface、完整陌生用户可用性、真实 provider 价格与长期数据仍未完成。

V5.32 收敛了公开安装面：默认只有 `core`、`channels`、`delivery`、`continuity` 四个入口，`attention` 按需安装，`evolution`/`control`/`gateway` 仅为兼容或高级入口，`full` 仅供维护者。`channels` 当时不强制安装 Control Center；V5.71 根据真实用户路径复核已改为随附轻量 Control Center，而仍不带 Attention。十二个物理 Bundle 的独立启停、权限和卸载边界保持不变。套件 audience、四包 `core` tarball 和 `check:suites` 结果见 [V5.32](evidence/v5-32-install-surface-convergence-2026-08-26.zh.md)；当前修正见 [V5.71](evidence/v5-71-channel-suite-control-center-and-real-run-2026-09-03.zh.md)。

V5.47 又把这一分类写入 `pack:suite --help`：帮助只把四个用户入口放在第一层，单独标记 `attention`、兼容/高级入口和维护者 `full`，避免把内部 Bundle 数量误解为产品选择数量。实际 `core` 打包仍生成四个官方 tarball；当前单渠道 `channels --channel feishu|telegram` 生成轻量 Control Center、Gateway 与所选 Adapter，完整修正见 [V5.71](evidence/v5-71-channel-suite-control-center-and-real-run-2026-09-03.zh.md)。

V5.50 收口了双版本生命周期探针的浏览器副作用：目标 CLI 先按帮助输出选择 `--no-open`（rc.2）或无该参数的
`--port` 契约（rc.5），直接 `appBoot` 组装也同步处理；两个 macOS assembled job 与本地双版本 clean-profile
均通过，且当前 CI 四矩阵全绿。此前 `56017` 等随机端口死标签的根因、修正与单一 `3080` 浏览器实测见
[V5.50](evidence/v5-50-single-browser-lifecycle-2026-08-26.zh.md)。这不改变真实飞书、真实 Provider、Hermes
paired 和长期效果仍为发布阻断的事实。

V5.51 将长期效果评测从散落的 TODO 收口为 `dsh-evolve` 的 `evoforge_long_term_effects` 持久事实域和
只读 Control/Remote/Web 投影。误晋升、遗忘、负迁移、重复外部效果、崩溃/重启恢复和回滚率都必须由
显式来源事实或不可变 selection event 计算；缺证据显示 `not-measured`/`unknown`，绝不由时间邻近或
模型自评推断。全包测试为 308 passed、1 skipped；真实长期 paired 数据尚未授权写入，release gate 继续
阻断。详见 [V5.51 证据](evidence/v5-51-long-term-effects-contract-2026-08-26.zh.md)。

V5.52 将 Gateway 出站 journal 的终态通过脱敏 Cordis Event 接入长期账本：`delivered` 只记为
`applied`，`uncertain/failed` 记为 `unknown`，幂等重试绝不自动算 duplicate；Adapter 必须提供
明确 `duplicateOfFactId` 才能形成重复效果事实。Gateway/dsh-evolve Typert 事件合同已按 pinned DSH
刷新，Gateway 10 项出站测试、构建 verifier 和 dsh-evolve typecheck 通过。真实渠道长期重连、平台
duplicate-of 事实和 paired 数据仍未授权，发布门继续阻断。详见 [V5.52 证据](evidence/v5-52-gateway-long-term-observation-2026-08-26.zh.md)。

V5.53 对当前 `main` 做了单浏览器真实交互复验：只使用 `http://127.0.0.1:3080/`，控制中心的 `渠道` /
`飞书内容` tab 切换、渠道状态刷新和整页 reload 均在同一原生 DSH Session 内完成；控制中心、Gateway
surface 在 reload 后恢复，浏览器 console error 为 0，没有再出现 `56017` 等第二页面。长期效果六项卡片
也位于同一 Evolution surface，缺证据时保持未测量，不伪造晋升或发布结论。详见
[V5.53 证据](evidence/v5-53-single-browser-control-center-long-term-effects-2026-08-26.zh.md)。

V5.54 将 Gateway journal 的中断恢复接入长期账本：冷启动前读取 `executing`/`sending`，按 Workspace 发出
脱敏 recovery Event；`dsh-evolve` 监听并通过 Gateway 只读快照 replay，内容寻址保证不重复。真实恢复事实
仍只在确有遗留记录时写入，未把普通启动或单测冒充长期成功；Gateway 两个测试文件 21/21、双包 typecheck
和 Typert 重生成通过。详见 [V5.54 证据](evidence/v5-54-gateway-recovery-long-term-facts-2026-08-27.zh.md)。

V5.55 将当前 `main` 的 core 套件通过官方 CLI 安装到真实 DSH `web` profile，并在用户授权凭据下冷启动
常驻 Host。`dsh-evolve`、`dsh-doctor`、`dsh-control-center`、`dsh-evolve-web` 与 Gateway/Feishu 同时加载；
单一 `3080` 页面中的原生控制中心完成运行诊断、渠道刷新、飞书内容/演化 Surface 切换和整页 reload，显示
1 个授权实时 Session、入站/出站各 3 条、待处理 0、飞书 WebSocket“连接正常”，浏览器错误为 0。该证据
只证明安装/启动/控制面恢复，不提升真实飞书消息、Provider paired、Hermes paired 或长期效果门状态。
详见 [V5.55 证据](evidence/v5-55-live-profile-cold-boot-2026-08-27.zh.md)。

V5.56 为 `dsh-resident` 增加受约束的 `noOpen` 配置：同一个 Web profile 可由 launchd/systemd 保活，
但不会在服务启动时打开第二个浏览器页面；launchd/systemd 均从同一 exact ProgramArguments 生成，仍不经过
shell，且 unit 不携带凭据。真实 launchd fixture 已验证 `--profile <fixture> --no-open`、SIGKILL 重启、
status、remove 与无残留；完整契约见 [V5.56 证据](evidence/v5-56-resident-web-no-open-contract-2026-08-27.zh.md)。

V5.57 将常驻 Gateway 的待批准请求接入同一原生 Control Center：Host 现在提供脱敏 pending request
列表，并支持管理员按不透明 `requestId` 直接批准；原有配对码输入仍兼容。请求 id 审批和 code 审批
都必须重新验证 live native Session、Workspace ownership、cwd、Agent preset、provider/model，并在
pairing store 中原子消费 pending binding；过期、重放、route 冲突和身份泄漏均 fail closed。Gateway
全部 35 项测试、Control Surface 3 项测试、Typert 重生成/构建通过。该增量只改善常驻配对的可操作性，
不提升真实 Feishu epoch-3、真实 Provider、Hermes paired 或长期效果门。详见 [V5.57 证据](evidence/v5-57-gateway-pending-request-control-2026-08-27.zh.md)。

V5.58 修复根 `pnpm test` 的 macOS assembled 并发竞争：`dsh-software-delivery` 不再与其它包并行
重建/打包，而是先跑 7 个快速测试，再以单 worker 串行跑 clean-profile 与 suite-upgrade。原先两个
assembled 文件的 180 秒/420 秒超时在修复后的独立串行路径均 2/2 通过；不放宽断言或发布门。详见
[V5.58 证据](evidence/v5-58-serial-assembled-test-runner-2026-08-27.zh.md)。

V5.59 将 V5.57 的待批准请求 Remote 原位安装到当前 `web` profile，并以用户授权的进程环境凭据启动
常驻 Host。无凭据启动按预期 fail closed；授权启动只保留一个 `127.0.0.1:3080` Host。单页浏览器复验
在原生 DSH Session 的 `控制台 → 渠道` Surface 完成：待批准请求、飞书配对、授权路由和刷新均可见，
刷新后仍停留在同一页面，console warn/error 为 0。该证据只证明新包已进入可运行 profile 和控制面交互，
不提升真实 Feishu epoch-3、真实 Provider、Hermes paired 或长期效果门。详见
[V5.59 证据](evidence/v5-59-live-gateway-pending-control-2026-08-27.zh.md)。

V5.60 将根测试第一批的跨包 `pretest → build → test` 生命周期改为单 workspace worker，消除
`dsh-evolve`/渠道 peer artifact 重建与 `dsh-resident` launchd fixture 的资源竞争；包内测试并行和既有
超时不变。完整 `pnpm test` 现已在同一 `main` 工作树退出 0：Evolution 308 passed/1 skipped、Resident
15 passed/1 skipped、Gateway 35、Telegram 29、Feishu 45，Software Delivery 快速批次和两个 assembled
文件也全部通过。`check:ci` 固化该编排门；真实外部验收状态不变。详见
[V5.60 证据](evidence/v5-60-deterministic-root-test-2026-08-27.zh.md)。

V5.61 删除 AS-2 真实飞书验收的终端配对码转录。验收器现在等待常驻 Gateway 的脱敏 pending request，
按 exact Feishu App hash 要求唯一匹配，再通过生产 `approvePairingRequestForSession` 门绑定原生
Workspace/Session，并验证 request 原子消费和首条消息未进入 Agent；机器人 code 仅保留为产品兼容路径。
类型检查和 10/10 合同测试通过，但新的真实纵切尚未完成，发布门不变。详见
[V5.61 证据](evidence/v5-61-feishu-acceptance-host-pending-approval-2026-08-27.zh.md)。

V5.62 清理公开文档的历史漂移：英文 README 不再把已实现的 existing-Skill paired/Retention/Canary/
Promotion 写成缺失，中文入口同步 request-id pending 审批；安全策略删除已下线的 Feedback Draft 参数，改为
当前 DSH 单权威、内部证据、内容寻址 Candidate、治理/评测/变更分离、future-Session 固定、凭据脱敏和
Gateway 授权边界。真实外部门禁仍未通过。详见
[V5.62 证据](evidence/v5-62-public-security-capability-sync-2026-08-27.zh.md)。

V5.63 将 Changelog 和机器可读飞书发布门同步到当前事实：旧 code-entry run 保留为失败证据，V5.61 的
request-id Host 修正加入 evidence，但 `real-feishu-as2` 继续为 `failed`，直到新的真实私聊、Schedule、
Approval、重启、卸载与 Session readback 全部 terminal passed。详见
[V5.63 证据](evidence/v5-63-public-release-state-sync-2026-08-27.zh.md)。

V5.64 对新的 AS-2 失败做了只读事件到达诊断：最终包安装、profile dump 和官方 WebSocket handshake 均为
`ready`，但人工窗口内没有 Feishu pending request，验收器因此没有进入 Agent 或发送任何挑战消息。Bot info
HTTP 200/`code=0` 且机器人 active；事件订阅读取因 App 未开通 `event:subscription:read` 被 Feishu 拒绝，
未修改权限或订阅。代码侧连接 ready 与事件到达已严格分层，仍需后台确认 `im.message.receive_v1` 并由测试
账号发送新私聊。详见 [V5.64 证据](evidence/v5-64-feishu-event-arrival-diagnostic-2026-08-27.zh.md)。

V5.65 修正同页控制面的可见性：`渠道` Surface 现在每 5 秒只读轮询 Host 的脱敏 pending pairing projection，
陌生私聊到达后无需手动刷新或打开第二个网页即可出现；轮询失败保留最后一次权威列表，旧响应不会覆盖新状态。
Gateway typecheck、8 个测试文件/36 项测试和既有 Control Center 合同通过。该增量不改变真实 Feishu AS-2、
真实 Provider、Hermes paired 或长期效果发布门。详见 [V5.65 证据](evidence/v5-65-gateway-pending-polling-2026-08-27.zh.md)。

V5.66 在同一 `渠道` Surface 的 Adapter 技术详情中补充 Host 已记录的连接时间、最近活动和最近错误，
用来区分“WebSocket ready”与“确实收到平台事件”；空值显示“尚无记录”，不发起平台探测、不读取凭据、不调用模型。
Gateway typecheck、8 个测试文件/36 项测试通过。该增量不提升真实 Feishu AS-2、真实 Provider、Hermes paired
或长期效果发布门。详见 [V5.66 证据](evidence/v5-66-gateway-transport-activity-2026-08-27.zh.md)。

V5.67 为公共 Control Center 补齐原生 ARIA tabs 键盘导航：Surface tab 使用 roving `tabIndex`，支持四个方向键、
`Home`/`End`，活动内容挂在唯一 `tabpanel`，避免悬空引用；鼠标、键盘和移动端仍留在同一个 DSH
`conversation.view`，不增加新网页、Router、Session 或模型调用。Control Center typecheck、2 个测试文件/4 项测试通过，
并在真实 DSH Web 单页验证切换、刷新恢复、应用级 error 0 和单标签。该增量不提升真实 Feishu AS-2、真实 Provider、
Hermes paired 或长期效果发布门。详见 [V5.67 证据](evidence/v5-67-control-center-keyboard-navigation-2026-08-28.zh.md)。

V5.5 按 [ADR-0090](adr/0090-feishu-content-reads-are-agent-scoped-native-tools.md) 在 `dsh-feishu` 内增加一个
Agent-scoped 原生 `feishu_content_read` Tool。document、Wiki、Drive metadata、Bitable records 四项权限独立且
默认关闭；每次读取走真实 ToolRuntime/Approval，当前 Session schema 固定，撤权后执行拒绝，新启用只影响
未来 Session。官方 SDK 映射、边界、取消、脱敏、durable Tool result 和 dispose 已由 assembled DSH 验证；
`dsh-gateway` 未增加内容业务。详见 [V5.5 证据](evidence/v5-5-feishu-independent-content-read.zh.md)。真实飞书
App scope、资源权限、真实内容和真实用户审批仍 pending。

V5.6 按 [ADR-0091](adr/0091-feishu-content-readiness-is-host-authoritative.md) 把 `/feishu` 升级为 V2 Host
权威投影：四项配置权限、exact Agent 的 Tool registry、Approval seam 和 request header 共同决定
`disabled/ready/future-session-only/approval-unavailable/tool-unavailable`，已配置但当前不可执行时总健康进入
`attention`。同包 DSH Web 不新增 Remote 或配置动作，明确显示平台权限 `not-verified`。最终 tarball 已在
真实 DSH Web 验证权限/Tool/Approval、人工刷新、Host 停机清除旧快照、同端口无 reload 恢复和 console
error 0。详见 [V5.6 证据](evidence/v5-6-feishu-content-readiness-web.zh.md)。该门未调用真实飞书内容 API。

V4.50 按 [ADR-0092](adr/0092-skill-reuse-is-bound-to-exact-content-generation-and-goal.md) 增加 Host 权威的
Exact Skill Use 与 Cross-Goal Skill Reuse。成功原生 Skill 调用只有在官方 Session flush 后才绑定 active Goal、
模型可见内容哈希和 Session-pinned Generation；相同 exact 版本至少跨两个 Goal 才显示复用，同 Goal retry、失败、
内容或 Generation 漂移均不合并。最终 tarball 已在全新 profile 的真实 DSH Web 验证 2 uses/2 Goals、整页刷新、
Host 冷启动恢复、合法 Session readback 与官方卸载。详见 [V4.50 证据](evidence/v4-50-exact-cross-goal-skill-reuse.zh.md)。
该门固定无因果、无发布权，不证明成功、提升、Retention 或整体自进化完成。

V4.51 按 [ADR-0093](adr/0093-exact-skill-outcome-context-is-temporal-not-causal.md) 增加
Exact Skill Outcome Context。Host 只为 exact 跨 Goal 版本连接同 Session/Goal/Generation、发生在 use 之后且
revision 不倒退的 durable Outcome，展示 missing、attempt、recovered、ambiguous latest 和唯一 latest 的 Goal
metrics；全量 rollup 与最多 20 行明细分离。最终 tarball 已在真实 DSH Web 验证 2/2 Goal、3 attempts、1
recovered、2 measured，整页刷新、Host 断连保留、同 profile 冷恢复不重复和官方卸载。详见
[V4.51 证据](evidence/v4-51-exact-skill-outcome-context.zh.md)。该视图无因果、无 improvement claim、无发布权。

V4.19 贯穿红测发现 V4.18 把治理生成的 admission/holdout 都标成 assembled，导致确定性 Admission 固定返回 `assembled-evaluator-not-governance-separated`；现已按 [ADR-0063](adr/0063-governance-splits-deterministic-admission-from-assembled-holdout.md) 修成“不执行 Candidate 的 deterministic admission → 独立 assembled holdout”。治理 budget deny 持久化为 `budget-deferred`，作者调用异常后立即持久化 `uncertain`；Host/Web 只读展示 phase、0–2 次调用、token、retry 与脱敏失败分类，仍不暴露 protected Goal、evaluator、provider identity 或路径。详见 [V4.19 证据](evidence/v4-19-governance-admission-handoff.zh.md)。本机没有两套独立真实 provider 配置，因此状态仍是 `implemented`，不能升级为真实 provider `verified`。

V4.20 按 [ADR-0064](adr/0064-corrections-require-exact-durable-skill-invocation.md) 删除 correction 的 same-Session/unique-Gap 猜测：Host 从 feedback 目标回答的 durable turn 解析唯一成功 Skill invocation 和 exact Goal id/revision，歧义即 abstain；Signal 跨 Storage restart 保留有界身份，Web 分开展示 exact correction attribution 与非因果 Delivery Outcome association。详见 [V4.20 证据](evidence/v4-20-exact-durable-feedback-attribution.zh.md)。该增量没有把 correction 扩权为 Opportunity 资格或 Candidate，也没有完成 existing-Skill 再进化。

V4.21 按 [ADR-0065](adr/0065-existing-skill-improvement-requires-exact-invocation-content.md) 给 exact correction attribution 增加 durable invocation-content hash；同名内容漂移会分流，legacy 无 hash 只读。只有同 Workspace/Skill/hash 在至少两个不同 Goal 的去重纠正才形成独立 `waiting-for-baseline-bundle` 调查，Web 明示 exact version、无因果和 Candidate 阻断。详见 [V4.21 证据](evidence/v4-21-existing-skill-improvement-investigation.zh.md)。完整 Bundle baseline、skill-tree Envelope、Candidate 与晋升仍未实现。

V4.25 按 [ADR-0070](adr/0070-retention-reserves-independent-pre-candidate-goal-evidence.md) 将第五个内部 Goal 变成生成前的独立 Retention 分区，而不是运行时配置 target、外部 Case 或重用 holdout。治理以第三个 Candidate-independent author 调用形成独立 assembled Retention Case Pack；Envelope v5、Host/Remote 与 DSH Web 只暴露数量、阶段和聚合成本。详见 [V4.25 证据](evidence/v4-25-independent-retention-case-pack.zh.md)。该增量当时只到 Case Pack 准备；后续 V4.26 已补 execution/verdict，V4.27 已补权威 Web 投影。

V4.26 按 [ADR-0071](adr/0071-retention-continues-the-exact-candidate-shadow-job.md) 把 Envelope v5 Retention 分区接入 exact-Candidate Shadow 的同一 DSH Jobs 任务。Admission 每次重验 Case Pack hash/run root；Retention 重读 durable Shadow state/report、Lineage v3、subject、Candidate tree、DSH revision、预算和 composition 后，才以零 proposer 调用执行 paired Trial。运行按 Candidate/Admission/Envelope/Shadow/Case Pack 内容寻址并加锁；terminal verdict 可幂等复用，status/reason/evidence 脱钩会 fail closed。详见 [V4.26 证据](evidence/v4-26-exact-candidate-retention-execution.zh.md)。它仍无 release authority；后续 V4.29 已补独立 promotion eligibility，V4.31 已补无发布权的 canary evidence，真实 provider outcome 仍 pending。

V4.27 按 [ADR-0072](adr/0072-web-joins-owner-projections-with-exact-lineage.md) 让 `ReviewInbox` 与 `InternalSkillRetention` 各自保有 Shadow/Retention 权威制品，再由 Host 按 exact lineage/tree 只读拼接。Retention root 缺失表示未运行；prepared、terminal、verdict/token 形状或内容地址篡改会告警。Remote/Web 不下发 Host path、protected Goal/Case、evaluator、provider 或 proposal，只展示 holdout/Retention 对照、composition、trial、calibration、proposer=0、model/token/cache 与无发布权。详见 [V4.27 证据](evidence/v4-27-shadow-retention-web-projection.zh.md)。后续 [V4.28](evidence/v4-28-shadow-retention-real-browser.zh.md) 已从最终 tarball 安装到隔离 DSH profile，验证整页 reload、Host 停机 fail-visible、最后成功证据保留和同 profile/端口恢复；真实 provider Retention 仍 pending。

V4.29 按 [ADR-0073](adr/0073-promotion-revalidates-exact-retention-without-giving-it-release-authority.md) 增加独立 Host Promotion Eligibility。它不把发布权交给 Shadow、Review 或 Retention；每次命令/Web 晋升前重读 exact approved Generation 与治理证据，只有唯一且结构一致的 retained verdict 才能写 active selection。缺失/准备中状态等待，扫描告警、归属/谱系错配、重复、回归、不完整和 verdict/evidence 脱钩全部 fail closed；DSH Web 显示状态/原因/Retention id 并禁用非 eligible 按钮。最终 tarball 已在隔离 profile 的真实 DSH Web 验证 eligible/enabled、regressed/disabled、Host 失败保留证据、同端口恢复和卸载。详见 [V4.29 证据](evidence/v4-29-retention-promotion-eligibility.zh.md)。本增量不包含 canary、真实 provider 或自动晋升。

V4.30 完成本地 Git 和活动文档收口：所有已提交旧分支均经 ancestor 审计后保留在 `main` 历史，标准路径现只有一个 `main` worktree/本地分支；已撤销的能力获取、Feedback/Evaluator Draft、静态 Target 和旧 canary 架构/证据页已从活动文档删除，README 和进化架构已按当前 Retention/Promotion 实现重写。详见 [V4.30 证据](evidence/v4-30-main-worktree-and-active-doc-convergence.zh.md)。

V4.31 按 [ADR-0074](adr/0074-failed-outcomes-produce-sealed-canary-evidence-without-release-authority.md) 从当前 internal Candidate 证据链重建反事实 Canary。新失败 Outcome 只负责唤醒原生 DSH Job；Host 重新绑定 Promotion Eligibility、Review、Retention、Admission、Envelope、Candidate、pre-Candidate subject 与 exact tree/Case Pack，零 proposer 重跑 assembled paired Trial。结果内容寻址且固定无 release authority；`review`/`rollback-eligible` 停止重复花费，`keep` 才允许后续失败继续监测。Control/Remote/Web 显示有界证据而不暴露路径或 protected case。详见 [V4.31 证据](evidence/v4-31-failed-outcome-counterfactual-canary.zh.md)。该增量当时尚无独立 rollback action；后续 V4.32 已补 expected-active Host gate，真实 provider/浏览器故障恢复和长期误回滚数据仍缺。

V4.32 按 [ADR-0075](adr/0075-rollback-revalidates-exact-evidence-and-active-pointer.md) 增加唯一 `FutureSessionRollback` Host mutation seam。人工紧急回滚无需 Canary 配置；证据动作必须带 exact `rollback-eligible` Canary id，并重验 Workspace、当前 active Generation、terminal verdict 和完整 bounded evidence。两条路径都把资格检查时观察到的 active id 传入 Generation Store，在串行写临界区执行 expected-active compare；指针漂移会失败且不误回滚。Command、Remote、Web 共用该 gate，Web 从 exact Canary 行发起二次确认，Canary 本身仍无发布权。详见 [V4.32 证据](evidence/v4-32-exact-canary-rollback-gate.zh.md)。真实 provider、最终 tarball 浏览器故障恢复和长期误回滚率仍未完成。

V4.33 按 [ADR-0076](adr/0076-installed-skill-baselines-seal-at-native-invocation-boundary.md) 在 native Agent `pre-step` 自动识别用户显式和成功模型 Tool 两种 durable Skill 调用。Host 先以 `agent/session-start` 高水位拒绝用当前目录追溯重建冷恢复历史调用，再对新调用以相同 scope/cwd 重载官方 Skill definition、逐字匹配 `renderSkillContent()`，只对独立 `<resourceBase>/SKILL.md` 目录双扫描并封存完整 regular-file Bundle；flat/URL/opaque、link、executable、超预算和漂移均 abstain。内容寻址 baseline 与 `(Workspace, Session, invocation seq)` 引用分离，重读重新验证 archive/manifest，固定无发布权。详见 [V4.33 证据](evidence/v4-33-installed-skill-baseline-seal.zh.md)。该增量尚未把 investigation 推进到 existing-Skill Candidate 或 paired evaluation。

V4.34 按 [ADR-0077](adr/0077-existing-skill-authoring-requires-one-exact-baseline-bundle.md) 增加 `ExistingSkillBaselineQualification`。Host 重新核对当前调查和全部 exact FeedbackSignal，再逐个解析不可变 Session/invocation reference；只有 route/Skill/hash 都一致且所有调用落到同一完整 baseline id 才产生内容寻址的 authoring 资格。缺引用等待，证据漂移、archive 损坏、归因错配和同正文不同 Bundle 全部 invalid；控制面/Web 只显示有界 baseline 摘要与计数，固定无 Candidate、安装或发布权。详见 [V4.34 证据](evidence/v4-34-existing-skill-baseline-qualification.zh.md)。下一步是 protected whole-tree author 与 existing baseline/candidate 独立评测链。

V4.35 按 [ADR-0078](adr/0078-existing-skill-corrections-are-sealed-before-authoring.md) 增加 `ExistingSkillEvaluationEvidenceVault`。它不把纠正文复制进 reference-only Signal，而是在 authoring 前通过官方 Message Feedback 与 Session Persistence 重读当前值，重验 exact message/version、assistant、Skill invocation、Goal revision 和用户请求。四个不同 Goal 预分为 2 authoring/1 admission/1 holdout，第五个及以上再隔离 1 Retention；同 Goal 重复不计，少样本不读取正文。内容寻址 manifest 篡改、feedback/Session 漂移和服务缺失均 fail closed；Host/Remote/Web 只显示 readiness、id 与计数。详见 [V4.35 证据](evidence/v4-35-existing-skill-correction-evidence-seal.zh.md)。下一步仍是 protected whole-tree author 与 existing baseline/candidate 独立评测链。

V4.36 按 [ADR-0079](adr/0079-existing-skill-authors-produce-quarantined-whole-tree-candidates.md) 增加 `ExistingSkillCandidateAuthoring` 和独立 existing-Skill Candidate contract。Module 自主消费内部 Opportunity，只把 exact baseline 有界文本、二进制元数据和 authoring cases 交给 proposer；Host 只接受 `SKILL.md`/`references/*.md` 文本 diff，完整继承其余文件，拒绝 identity/path/code/binary/permission 漂移。Candidate 以 baseline/qualification/evidence/author/archive/tree 内容寻址，持久为 inactive/quarantined/unevaluated/never-executed/no-release-authority；paid-call uncertain 不盲重试。Host/Remote/Web 显示 phase/cost、精确 identity、tree 与 bounded diff，不下发 claim、正文或保护样本。详见 [V4.36 证据](evidence/v4-36-existing-skill-whole-tree-candidate.zh.md)。下一步是 existing baseline/candidate 独立 paired evaluation、Retention/Canary/晋升链。

V4.37 按 [ADR-0080](adr/0080-existing-skill-structural-admission-is-a-separate-paired-subject-gate.md) 增加独立 `ExistingSkillCandidateAdmission`。Host 只按 exact 内容地址重读 installed baseline 与 Candidate 整包，绑定 governance-only admission sample，重算 archive/tree 并逐字核对 changed/added/preserved/binary；identity/evidence 漂移、删除、未声明 diff 和越界文件修改全部阻断。运行由原生 Jobs 调度并以 durable state/result 加锁恢复，terminal 幂等，暂不可用 incomplete 可重试。通过态固定 `qualified-for-holdout`、`candidateExecuted: false`、`releaseAuthority: none`；Host/Remote/Web 分栏显示双树、diff 和 protected sample 摘要，不把结构完整性冒充效果胜出。详见 [V4.37 证据](evidence/v4-37-existing-skill-exact-paired-structural-admission.zh.md)。下一步是独立生成 protected holdout evaluator/Case Pack 并执行真实 assembled `skill-tree ↔ skill-tree` Trial。

V4.38 按 [ADR-0081](adr/0081-existing-skill-holdout-is-authored-before-the-candidate.md) 增加 `ExistingSkillHoldoutGovernance`。治理作者只接收 exact baseline 与唯一 protected holdout，不接收 Candidate/diff/claim；同 proposer model identity 在预算前阻断。Host 完整继承 baseline references/assets/binary，组装 synthetic known-bad 与独立 known-correction `skill-tree`，以 assembled evaluator 完成零 proposer calibration 后原子安装内容寻址 Envelope。该门在 `ExistingSkillCandidateAuthoring` 的同一原生 Jobs task 中先于 proposer 执行；holdout budget deferred、paid-call uncertain 和 calibration failure 都不会占用 proposer 预算或生成 Candidate。Host/Remote/Web 独立显示 phase、exact identity、成本、retry/failure 与 Envelope id，不下发 protected 内容、evaluator、provider 或路径。详见 [V4.38 证据](evidence/v4-38-existing-skill-candidate-blind-holdout-governance.zh.md)。该增量自身没有效果判决；V4.39 已消费其 Envelope 执行 exact paired holdout。

V4.39 按 [ADR-0082](adr/0082-existing-skill-effect-verdict-requires-an-exact-paired-holdout.md) 增加 `ExistingSkillHoldoutEvaluation`。新 Candidate 的 authorship/content identity 必须纳入生成前 exact Envelope；可读 legacy 无绑定 Candidate 和 Envelope id 错配都在 Trial 前阻断。它只消费 exact `qualified-for-holdout` Admission、immutable baseline、whole-tree Candidate 与 Candidate 已绑定的 Candidate-blind Envelope，并在同一 assembled DSH Trial 中运行完整双树；calibration、assembled、composition、输入完整性和固定 Trial 数全部通过后，才按 `fail/pass` 四象限持久给出 `improved/ambiguous/not-improved/regressed`。Candidate 物化漂移受保护，付费结果未知不盲重试，启动扫描与实时回调共用原生 Jobs，全部结果固定无发布权。最终 tarball 已用真实 DSH 浏览器验证投影、reload、Host 断连保留快照、同端口恢复、console error 0 与官方卸载。详见 [V4.39 证据](evidence/v4-39-existing-skill-exact-paired-holdout-evaluation.zh.md)。自动化成功 Trial 仍为注入式确定性 executor；下一步是 existing-Skill Retention/Canary/晋升/回滚和两套独立真实 provider。

V4.40 按 [ADR-0083](adr/0083-existing-skill-retention-is-sealed-into-the-pre-candidate-envelope.md) 把第五个独立 Goal 的 Retention 从“仅在 Evidence Seal 中保留”推进到 Candidate 前 Evaluation Envelope。五 Goal 路径按 Holdout、Retention 两次独立付费调用，每次只接收 exact baseline 和一个 protected Goal；两套完整 `skill-tree` Case Pack 分别校准、哈希并原子进入 v3 Envelope，Candidate 内容 id 继续绑定整个 Envelope。四 Goal及 legacy v2 明确无 Retention；历史无 `pendingRole` 的付费 Holdout 状态安全转为 `uncertain`，新第二次调用未知也不盲重试。Host/Remote/Web 显示 role、Retention presence、聚合成本和细分失败，不下发保护正文或路径。详见 [V4.40 证据](evidence/v4-40-existing-skill-pre-candidate-retention-governance.zh.md)。该增量尚未执行 Retention Trial，也没有晋升权。

V4.41 按 [ADR-0084](adr/0084-existing-skill-retention-requires-an-authoritative-improved-holdout.md) 增加 `ExistingSkillRetentionEvaluation`。它只接受同一 Candidate 的唯一、无 warning、全部 gate 成立且 verdict 为 `improved` 的权威 Holdout；随后重新解析 exact baseline、whole-tree Candidate、Admission、Envelope、Holdout/Retention Case Pack 与固定 DSH revision。四 Goal无独立 Retention 时零花费 abstain；五 Goal执行完整 `skill-tree ↔ skill-tree` paired Trial，并把 `fail/pass`、`pass/pass`、`fail/fail`、`pass/fail` 分别持久判为 retained/ambiguous/not-retained/regressed。运行前先持久化 paid-dispatch 边界，冷恢复不盲目重复 Trial；运行后重算四组输入 hash，畸形 usage、gate/verdict 脱钩和内容漂移全部 fail closed。实时 Holdout 回调与冷启动扫描都只唤醒原生 DSH Jobs，结果固定无发布权。详见 [V4.41 证据](evidence/v4-41-existing-skill-exact-retention-evaluation.zh.md)。本增量尚未包含 Retention Web/真实浏览器、真实 provider、Canary、晋升或回滚。

V4.42 按 [ADR-0085](adr/0085-existing-skill-retention-web-reads-only-host-authority.md) 把 V4.41 的有界 Host 投影加入现有 DSH Web Skills 视图。页面显示 exact Candidate/Holdout/Admission/Envelope、四棵内容树、四象限、integrity gates、model/token/cache 与无晋升/发布权；不读取保护正文、Host 路径或 provider identity。最终 tarball 已在隔离 profile 的真实浏览器验证首次读取、整页 reload、Host 断连后错误可见且最后证据保留、同 profile/端口恢复、console error 0 与官方卸载。详见 [V4.42 证据](evidence/v4-42-existing-skill-retention-web-browser.zh.md)。确定性 fixture 不替代两套真实 provider。

V4.43 按 [ADR-0086](adr/0086-existing-skill-release-is-a-separate-host-mutation-gate.md) 增加 `ExistingSkillRelease`，不复用 capability-absent Shadow Review。独立 lineage 绑定 parent baseline、Candidate、Admission、Envelope、Holdout/Retention 与两套 Case Pack；唯一无 warning 且全部 gate 成立的 `qualified + improved + retained` 才可由人工 approve 发布 inactive Generation，`promote-existing` 另行选择未来 Session，reject 终态持久化。完整 sealed Bundle 支持继承二进制，DSH Storage 冷重启保留决定。真实 DSH Agent/Session/SkillRegistry 自动化已证明同名 Skill 晋升只影响新 Session、旧 Session固定、显式回滚后新 Session恢复原生、已固定 Candidate 的 Session不漂移。详见 [V4.43 证据](evidence/v4-43-existing-skill-release-host-gate.zh.md)。当时缺失的 Control/Remote/Web 已由 V4.44 补齐，最终 tarball 浏览器已由 V4.45 补齐，failed-Outcome Canary Host/Jobs 已由 V4.46 补齐，其 Control/Web/rollback gate 已由 V4.47 补齐，最终包 Canary 恢复已由 V4.48 补齐；两套真实 provider 仍未完成。

V4.44 把 V4.43 的同一个 `ExistingSkillRelease` owner 接入 `EvolutionControlPlane`、固定 DSH Typert Remote 和 `dsh-evolve-web`。bounded projection 显示 exact baseline/Candidate/diff、Admission/Holdout/Retention、状态、阻断原因与 future-Session active 状态，不下发 Candidate body、protected case、Host path、provider identity 或凭据；Candidate 与 release identity 不能一一对应时读取失败关闭。Web 的 per-Candidate 人工备注及 approve/reject/promote 都需要确认，批准仍只产生 inactive Generation，另一动作才晋升未来 Session；Control/Remote/Web 不写 Store 或 pointer。详见 [V4.44 证据](evidence/v4-44-existing-skill-release-control-web.zh.md)。

V4.45 从最终 `dsh-evolve`/`dsh-evolve-web` tarball 和 clean profile 验证同一发布门：approve、冷恢复、独立 future-only promote、reload、断连恢复与官方卸载均通过。详见 [V4.45 证据](evidence/v4-45-existing-skill-release-final-browser.zh.md)。

V4.46 按 [ADR-0087](adr/0087-existing-skill-canary-replays-retained-evidence-without-mutation-authority.md) 增加 `ExistingSkillCounterfactualCanary`。失败 Outcome 只触发怀疑；Host 必须重验 active approved release、专用 lineage、retained 结果和 exact baseline/Candidate/Retention Case Pack，才由原生 DSH Jobs 做零 proposer paired replay。Candidate fail 只有在 baseline pass 时才是 `rollback-eligible`，双失败只进入 review；pointer 漂移、证据漂移与 paid-uncertain 均 fail closed，结果无 mutation 权。详见 [V4.46 证据](evidence/v4-46-existing-skill-failed-outcome-canary.zh.md)。当时缺失的 Control/Web 与独立 rollback gate 已由 V4.47 补齐，最终包浏览器已由 V4.48 补齐；两套真实 provider 与长期率仍未完成。

V4.47 按 [ADR-0088](adr/0088-existing-skill-rollback-is-an-independent-expected-active-host-gate.md) 将 existing-Skill Canary 的有界权威证据接入 Control、固定 Typert Remote 和 DSH Web，并新增 distinct `rollbackExistingSkill` action。独立 `ExistingSkillFutureSessionRollback` 每次人工请求重验 configured policy、零 warning、唯一 terminal verdict、当前 active Generation、四个 sealed hash、完整 paired integrity 及权威 approved release 全谱系；随后把观察到的 active id 交给 Generation Store 做串行 expected-active compare。Evaluator 没有 writer，Web 必须从 exact Canary 行二次确认，当前 Session 保持固定。详见 [V4.47 证据](evidence/v4-47-existing-skill-canary-control-rollback.zh.md)。后续最终 tarball 实际 rollback/断连恢复已由 V4.48 完成；两套真实 provider 与长期误回滚率仍未完成。

V4.48 从最终 `dsh-evolve`/`dsh-evolve-web` tarball 和全新 DSH profile 验证 existing-Skill 整条 release→Canary→rollback 生命周期：Web 人工 approve 只发布 inactive Generation，独立 promote 只影响未来 Session；Host 重启后 exact Canary 显示 baseline 恢复/Candidate 失败和无 mutation authority；回滚 Remote 在 Host 断连时 fail-visible 并保留最后证据，同 profile/端口恢复后由独立 gate 完成 expected-active rollback。整页 reload 与再次 Host 冷重启仍保持 inactive release、历史 Canary 和无回滚按钮；官方 remove 后默认 dump/`node_modules` 无残留，原生 DSH Web 可重启，console error 0。详见 [V4.48 证据](evidence/v4-48-existing-skill-canary-rollback-final-browser.zh.md)。fixture 不替代两套真实 provider。

V4.49 从最终 `dsh-evolve`/`dsh-evolve-web` tarball 和全新 DSH profile 验证 missing-Skill 整条 Generation→Canary→root rollback 生命周期：Web 人工 promote 只选择未来 Session，Host 重启后 exact Canary 显示 baseline 恢复/Candidate 失败且自身无 pointer writer；回滚在 Host 断连时 fail-visible 并保留最后证据，恢复后由生产 `FutureSessionRollback` 完成 expected-active root rollback。再次冷重启保持 inactive Candidate、历史 Canary 和无回滚按钮；官方 remove 后默认 dump/`node_modules` 无残留，无 overlay 的原生 DSH Web 可启动且无“演化”入口，console error 0。详见 [V4.49 证据](evidence/v4-49-missing-skill-canary-rollback-final-browser.zh.md)。fixture 不替代两套真实 provider。

V4.52 已在 V4.51 的 exact Skill Outcome Context 内增加尝试间新增工作投影。相邻 Outcome 只有在时间严格有序、
两侧 DSH Goal metrics 同源同 Goal、event seq 前进且所有累计 counters 单调时才相减；并列时间标记顺序歧义，
缺快照或回退记为 unmeasured。Host、Control、固定 Typert Remote、`/evolve status` 与 DSH Web 共用同一权威
summary；全仓类型、538 个通过测试、构建和生成契约已通过。最终 tarball 又从全新 profile 验证首次读取、刷新、
断连保留、同 profile 冷恢复不重复、整页 reload、官方卸载及原生 Web 无残留，详见 [V4.52 证据](evidence/v4-52-between-attempt-work-context.zh.md)。它仍不构成返工下降或 Skill 因果效果。

V4.53 已实现 [ADR-0094](adr/0094-repeated-exact-skill-failures-open-review-only-investigations.md) 的
`Exact Skill Failure-Context Investigation`。只有同一 exact Skill name/content hash/Generation 在至少两个不同
Goal 上都有唯一 latest failed 才 eligible；同 Goal retry、后来恢复、unknown/missing 与 latest 冲突均 abstain。
Host、Control、固定 Typert Remote、Command 与 Web 已共享同一投影，eligible 明细不会被 20 行上限隐藏；调查固定
无因果、无 Candidate/发布权。最终 tarball 已从全新 profile 验证 1 eligible/2 latest-failed、刷新、断连保留、
同 profile 冷恢复不重复、整页 reload、官方卸载及原生 Web 无残留，详见
[V4.53 证据](evidence/v4-53-exact-skill-failure-context-investigation.zh.md)。

V4.54 清除了活动评测链中残留的运行时搜索语义。Candidate-independent 治理作者返回的第三个字段改为
`evidenceRationale`，Case Pack 只保存到 `evidence/rationale.md`；Shadow 在执行 Candidate 前发生的路径/身份
拒绝改记为 `structural-admission`。测试同时断言新治理包不存在 `search` key 或目录。该增量没有新增外部
Skill 搜索、能力获取、市场或 provider 调用，也不能证明模型效果。详见
[V4.54 证据](evidence/v4-54-remove-runtime-search-semantics.zh.md)。

V4.55 增加阶段专用 RP-1 双真实 Provider 验收入口。它冻结 DSH revision、五条内部 Gap、调用预算和 hard
gates，复用生产 Opportunity、Evidence Seal、whole-Skill Candidate、Candidate-blind Governance、Admission、
assembled Shadow、Retention 与 DSH Jobs；没有另建插件、Session、Goal、Runtime 或 benchmark 服务。入口在精确
付费批准前不读取 Provider 配置，退出码 2 与 `status: not-run` 不会被记成通过；凭据、base URL 和私有路径不进入
公开报告，相同 terminal run 不盲重试。当前仅合同、类型与 `NOT_RUN` 路径通过，没有第二套独立 Provider，也没有
发起外部请求。详见 [RP-1 说明](../benchmarks/provider-v0.1/rp1-internal-skill-evolution/README.zh.md)与
[V4.55 证据](evidence/v4-55-real-provider-acceptance-gate.zh.md)。

V4.56 审计了四个真实 Provider HTTP seam：两个 proposer seam 原本已有 60 秒上限，两个治理 seam 原本可能
无限等待。缺失 Skill 与现有 Skill 的治理作者请求现在无论是否收到 Host 取消信号都保留 60 秒 wall-clock
上限；传入信号与 timeout 组合。dispatch 前 durable `authoring-pending`、异常转 `uncertain`、重启后拒绝盲重试
的治理语义没有改变。本次只执行可控 fake-fetch 与本地回归，没有外部 Provider 请求。详见
[V4.56 证据](evidence/v4-56-bounded-governance-provider-requests.zh.md)。

V5.7 审计公共渠道出站后确认：Gateway 已持久化发送 intent 和 `sending`，但过去只把 lifecycle signal 交给
Adapter；一个忽略 signal 的 Promise 可以无限阻塞 dispose/reload，飞书 Adapter 还把收到的 signal 丢在官方
HTTP port 之前。`registerTextAdapter()` 现在要求每个 Adapter 声明 `sendTimeoutMs`，Gateway 同时 race Adapter
Promise 与组合 signal；timeout/dispose 均把 exact durable delivery 收敛为 `uncertain`，绝不自动重发。Telegram
和飞书均固定 30 秒，飞书文本/Approval 卡片把 signal 传入官方 HTTP transport。详见
[V5.7 证据](evidence/v5-7-bounded-channel-delivery.zh.md)。

V5.8 把 exact 飞书真实渠道退出路径做成阶段专用 AS-2 入口，而不是新产品插件或能力获取面。入口在精确授权前
只读取批准变量；授权后才验证 App/chat/user/Secret、clean EvoForge/DSH revision 与隔离 run root，并从最终
`dsh-gateway`/`dsh-feishu` tarball 经官方 DSH CLI 走生产飞书 transport。入站 challenge、原生回复、`/feishu`、
平台观测 chat kind 与声明一致、`allowed-once` Approval、持久 notice、零 uncertain/failed、dispose、remove、原生
Session readback 都是 hard
gate；崩溃后的同一 run 不自动重放。合同 7/7 与独立类型检查已通过；本机无凭据，direct/group 均严格
`NOT_RUN`。详见 [V5.8 证据](evidence/v5-8-real-feishu-acceptance-gate.zh.md)。

V5.33 在获得真实 App 配置后实际启动了 epoch-3 runner：最终 tarball 安装、profile dump 和官方 transport readiness
均通过，但常驻 Gateway 等待真实私聊配对码时超时，`residentPairingGranted=false`，因此终态是 `failed`，未执行任何
回复、Command、Schedule、Approval、重启或卸载门。详见 [V5.33 失败记录](evidence/v5-33-real-feishu-pairing-timeout-2026-08-26.zh.md)。

本轮开源发布审计还补齐了 `dsh-control-center` 的包 README，并让 `check:release`/CI 强制检查每个公开 Bundle 的
MIT、仓库地址、README、Cordis patch 文件和导出契约；English README 与四个默认安装入口同步。该门只证明发布
元数据和文档可复核，不改变真实 Provider、真实飞书完整 epoch-3 或 Hermes paired 的未完成状态。

V5.40 对齐了公开安装路径：getting-started、根 README、飞书/Gateway README 统一指向 DSH 原生“控制台 → 渠道”，
并由 docs checker 拒绝旧侧栏/Router 渠道健康指引；历史 evidence/research 保留历史事实。证据见
[V5.40](evidence/v5-40-public-control-center-docs-2026-08-26.zh.md)。V5.39 把开源 CI 的 macOS assembled job
扩展为 rc.5/rc.2 双目标矩阵，同一验收集分别运行在两组已审计 DSH
revision；不再只测试旧 Host。证据见 [V5.39](evidence/v5-39-ci-dsh-dual-target-matrix-2026-08-26.zh.md)。V5.38
修复了开源 CI 的可重复性缺口：macOS assembled job 删除 7 个已物理移除的旧测试引用，根级 `pnpm check`
新增 `check:ci` 扫描所有 GitHub Actions 测试路径；干净 runner 不会再因 stale test path 在收集阶段失败。证据见
[V5.38](evidence/v5-38-ci-workflow-current-paths-2026-08-26.zh.md)。V5.37 在 V5.36 的基础上用实际打包的
`dsh-gateway`/`dsh-telegram` 和 loopback Telegram API 完成了
Telegram Surface 的真实 DSH 浏览器路径：Control Center 导航、`连接正常`、固定私聊 route、刷新、整页 reload
和应用层 browser error 0 均通过；它不冒充真实 Bot。Doctor 仍保留真实 Host 断连/恢复证据，且两者都只复用
原生 `/doctor`/`/telegram` Command。真实外部 Bot route 和完整陌生安装引导仍 pending，因此
`web-control-plane` 仍为 `partial`。证据见 [V5.36](evidence/v5-36-doctor-control-surface-browser-2026-08-26.zh.md)
和 [V5.37](evidence/v5-37-telegram-control-surface-browser-2026-08-26.zh.md)。

V5.41 修复了真实 GitHub runner 才暴露的两项可重复性缺口：`dsh-feishu` 直接声明 benchmark 使用的 `tsx`，
macOS assembled job 改为对审计过的 DSH 同时执行 Host/Client `build:lib`，并由 `check:ci` 固定该约束。
这解释了 rc.2 clean-profile 中缺失 `@deepseek-ai/dsh-typert-registry/lib/index.js` 的来源。修复后的 GitHub
运行尚未重新完成，因此不提升任何 release gate。详见 [V5.41](evidence/v5-41-ci-clean-runner-dependencies-2026-08-26.zh.md)。

V5.42 修复了随后由真实 Node 22/24 runner 暴露的类型检查前置缺口：根 `pretypecheck` 现在先构建
`dsh-control-center` 再构建 `dsh-gateway`，递归消费者不会依赖开发机残留的 `dsh-control-center/client` `lib`。
`check:ci` 固定该顺序；本地完整 `typecheck` 已通过，新的 GitHub 运行仍需复核，不提升 release gate。详见
[V5.42](evidence/v5-42-ci-typecheck-preflight-2026-08-26.zh.md)。

V5.43 修复了双 DSH assembled 矩阵中 Case Pack epoch 固定为 rc.2 的身份错配：每个 matrix job 现在在临时目录
生成当前 revision 的 Case Pack 副本，测试通过 `DSH_EVOLVE_CASE_PACK_ROOT` 使用它，生产严格校验保持不变。
本地 rc.5 四个 assembled Shadow 已 4/4 通过；新的 GitHub 运行尚未完成，不提升 CI 或 release gate。详见
[V5.43](evidence/v5-43-dsh-matrix-case-pack-identity-2026-08-26.zh.md)。

V5.44 继续修复真实干净 runner 的 DSH 组装前置：`build:lib` 不会生成 Web frontend dist，且部分崩溃 fixture
直接加载的 `dsh-llm/lib` 入口可能缺失；两个审计 revision 的 assembled job 现执行官方完整 `pnpm build`，
并由 `check:ci` 固定该路径。V5.44 的本地 rc.5 完整构建已通过，GitHub 修复后 run 尚未完成，因此不提升
任何 CI 或 release gate。详见 [V5.44](evidence/v5-44-ci-full-dsh-build-2026-08-26.zh.md)。

V5.35 将发布阻断提升为机器可执行的 `release-gates.json`：`check:release:gates` 会把 partial/not-run/failed
证据明确归为阻断，`release:tag` 还要求 clean `main` 且 `HEAD == origin/main`，只创建 annotated tag，不提供绕过
外部门禁的开关。当前该命令按设计失败，阻断项见 [release-gates.json](../release-gates.json)。

V5.9 修复 Runtime Readiness 的连接盲区：`dsh-feishu`/`dsh-telegram` 仅有 active fiber 不再足以让
`/doctor` 报 READY。Doctor 在命令时读取现有 Gateway 脱敏 transport facts，独立归约 unavailable、changing、
ready 与 degraded；损坏服务 fail closed。最终 Doctor tarball 已经官方 add/dump，在真实 DSH Loader 中完成
degraded→Cordis reload→ready→dispose/remove。该测试 Adapter 不是平台证据，真实飞书状态仍为 `NOT_RUN`。
详见 [V5.9 证据](evidence/v5-9-doctor-channel-readiness.zh.md)。

V5.10 给现有 Generation Store 增加与活动 pointer 同域同写的内容寻址 selection history。内部 Retention、
existing-Skill Release、显式人工和两类 Canary gate 都把 exact authority/evidence 交给唯一 Store writer；重复晋升
幂等，当前 Session pin 保持。Control/Web 显示有界前后版本、分类计数和无 outcome/release authority 声明。
最终 `dsh-evolve`/`dsh-evolve-web` tarball 已从全新 profile 验证真实晋升、reload、两次 Host 冷重启、Canary
root rollback、官方 remove 和原生 Web 无残留，console error 为 0。详见
[V5.10 证据](evidence/v5-10-generation-selection-history.zh.md)。

V5.11 在不可变 selection events 上增加严格有界的 post-selection Outcome window。Host 只读复用现有
Delivery Outcome Store，把每次选择之后、下一选择之前的事实按 Session-pinned selected/previous/other
Generation 分桶，展示结果、不同 Goal 和 token/cache/latency/active-wall；边界相等计歧义，选择时间不严格
递增就 abstain。最终 `dsh-evolve`/`dsh-evolve-web` tarball 已在真实 DSH Web 完成晋升、原生 Session Outcome、
断线保留、两次冷恢复、整页 reload、官方 remove 和原生 Web readback，console error 为 0。该窗口固定
bounded、无因果、无 mutation authority。详见
[V5.11 证据](evidence/v5-11-post-selection-outcome-window.zh.md)。

V5.12 重建了 existing-Skill 的低风险自动晋升，但没有恢复任何静态 Skill target。公开
`automaticPromotionPolicies` 只含 policy id 与 Workspace id；sole Host release owner 只接受 exact baseline 上
单一 `SKILL.md` 末尾 1–2048 bytes 追加、整包其余 bytes 不变、protected-effect 为空、Admission/Holdout/
independent Retention 全通过且 model/token/cache 不回退的 Candidate。自动决策和 inactive Generation 先持久化，
再只选择未来 Session；durable pause、父版本漂移、取消和 crash fail closed，原生 Jobs 从既有 durable facts
恢复。Control/Web 只读显示 eligible/pending/promoted/review/paused/blocked 与原因。最终 tarball 已从全新 profile
验证自动 decision、future-Session selection、整页刷新、Host 断线保留、同 profile 冷恢复、官方卸载和原生
Web 无残留；真实 provider 长期率仍待后续门禁。详见
[V5.12 证据](evidence/v5-12-existing-skill-automatic-promotion.zh.md)。

V5.13 审计发现冻结 Hermes EV-1 的 runner 仍引用 V4.23 已删除的 `GitSkillSource`，所以此前“可复跑”声明已
发生事实漂移。runner 现只组装 sealed `skill-bundle`，由 `GenerationBundleRepository` 在晋升前重验 exact archive/
tree/lineage，并使用 expected-active rollback。`pnpm benchmark:hermes` 的 EV-1/SD-1/LC-1/AS-1 四个 epoch 已
全部重新通过且 `result.json` 未改写；根级检查新增 EV-1 类型门。详见
[V5.13 证据](evidence/v5-13-hermes-ev1-content-addressed-replay.zh.md)。

V5.14 已从冻结 V5.11 revision 构建十一包历史最终 tarball，通过官方 DSH CLI 安装并由真实原生 Agent/Goal
记录一个内部 Capability Gap，再用当前十一包 tarball 原位升级。新版精确读回旧 Gap，并从另一个原生 Goal
记录同名 Gap 后形成 2-Goal Skill Opportunity；profile Bundle/配置行无重复。全部卸载后，升级前后两条原生
Session/Goal 仍可读。详见 [V5.14 证据](evidence/v5-14-suite-upgrade-lifecycle.zh.md)。

V5.15 [复核了 DSH 官方最新 `dsh-v0.1.1-rc.2`（`b150a55`）的附件与模型内容契约](research/dsh-current-attachment-contract-2026-08-24.zh.md)。新增的 DeepSeek Files API
只复用/上传确定性图片请求版本；核心仍没有 file/audio/video ContentBlock，官方 attachment README 也明确把这些
形态留给独立契约。因此本次不修改 Gateway 或飞书 Runtime，不以私有块、平台 key 或 Adapter 私库绕开 DSH。

V5.16 已把 rc.2 纳入与 rc.5 并列的 exact 支持矩阵。实现适配 rc.2 的 Command 图片参数、AttachmentStore
整批保存、图片规范化元数据和规范化后内容身份；测试适配器也覆盖新的 `prepareCall` 绑定契约。两版均通过
revision/version/clean-source guard、十一包 fresh-install 与冻结前代升级、原生 Agent/Goal/Gap、future-Session
固定/回滚、飞书聊天/内容 Approval/全通道缓存和卸载 readback。详见
[V5.16 证据](evidence/v5-16-dsh-dual-version-compatibility-matrix.zh.md)。

V5.17 已补齐 Software Delivery 的两个跨进程持久化窗口。真实 DSH Agent/Goal 运行正式
`complete_delivery`，其仓库 check 写入一次持久副作用探针；checkpoint 前 `SIGKILL` 不留下伪 Session/Outcome，
checkpoint 后但 Outcome 前 `SIGKILL` 可由 cold Session start 幂等补记一条 Outcome。恢复不调用模型、不重跑
Tool，call/result 与外部效果都保持一次。详见
[V5.17 证据](evidence/v5-17-delivery-outcome-process-crash.zh.md)。

V5.18 纠正飞书 Schedule 验收偏差：旧测试只是手工 `agent.followup()`；现在 assembled Host 真正加载官方
DSH Schedule，并通过 agent-scoped `schedule_create` 形成 durable create/dispatch、Schedule 插件来源到期 `user/message` 和
Agent turn。现有 Gateway journal 等待原生 `turn/end` 后只向 exact 飞书线程发送一次，不增加第二 scheduler 或
Feishu 私有日程状态。详见 [V5.18 证据](evidence/v5-18-native-schedule-feishu-delivery.zh.md)。

V5.19 把这条纵切推进到真实进程崩溃：独立 Host 在 create 已完成官方 Session flush、dispatch 前被
`SIGKILL`；下一 Host 由静态 Feishu Gateway route 恢复 exact Session，官方 Schedule 处理 overdue，Gateway
journal 达到一次 `delivered`；第三次 Host 启动不重放模型 turn、Schedule message、intent 或发送。exact rc.5/rc.2
均通过，生产 runtime 无需修改。官方 followup 已入队但 dispatch 未 checkpoint 的窄重复窗口仍未解决。详见
[V5.19 证据](evidence/v5-19-native-schedule-process-restart.zh.md)。

V5.20 对官方 followup→dispatch checkpoint 窄窗口做了真实反向故障注入：test-only JSONL backend 阻塞
包含 dispatch 的 batch，等待模型 turn 与第一条独立平台效果文件已经完成后 `SIGKILL`。恢复 Host 中 Schedule
重跑非 durable turn，但 append-only Session 顺序使 turn 号保持不变，Gateway 复用同一个 `route + turn`
durable intent；恢复 Fake Platform 发送 0 次，跨进程效果总数 1，Gateway attempts 1。rc.5/rc.2 均通过，未
增加生产 runtime 或 Schedule 业务状态；模型与成本仍可能重复。详见
[V5.20 证据](evidence/v5-20-schedule-dispatch-crash-outbound-dedup.zh.md)。

V5.21 将真实飞书 AS-2 从 epoch-1 升为 epoch-2。最终包 profile 不在已创建 Agent 上补挂 Tool，而是先加载
官方 DSH Schedule，再启动活动 Gateway route；验收器通过 agent-scoped `schedule_create` 要求同一原生 Session
精确出现一次 create、dispatch 和 Schedule 插件来源 `user/message`，生产飞书 route 的 durable delivered 计数增加，卸载后仍可读回。
终态解码器精确关闭十三项 observation，`passed` 必须全真，旧 epoch、缺 Schedule、畸形 verdict/Gateway facts
均不能复用。合同 9/9、独立类型与 Feishu 18 files/52 tests 通过；真实 App 长连接已启动，exact route
配对尚未完成，direct/group 仍为 `NOT_RUN`。详见 [V5.21 证据](evidence/v5-21-real-feishu-native-schedule-gate.zh.md)。

> **状态口径（2026-09-04 修正）**：本表中的“实现了代码合同/本地 assembled fixture”不等于真实可发行能力。
> 以 `release-gates.json` 和最新验收结果为准：双真实 Provider 为 `not-run`，真实飞书 AS-2 为 `failed/partial`，
> 外部 Telegram 与完整 Web newcomer 路径为 `partial`，Hermes paired 和长期效果为 `partial/not-run`。历史行若仍标有
> `implemented`，只表示本地实现存在，不能覆盖上述发布状态，也不能对外宣称 Hermes 上位替代；这一口径与 README、
> 发布门和本页“当前限制”一致。

| 能力 | 当前状态 | 已有证据 | 仍缺 |
|---|---|---|---|
| 原生 DSH 插件产品形态 | `implemented` | 十二包均有类型化 Client/Host plugin contract、Bundle patch、无 bin 合同；[V5.69](evidence/v5-69-dsh-alpha5-migration-2026-09-03.zh.md) 已把公开依赖和 assembled 矩阵迁移到 exact alpha.5；旧 rc.5/rc.2 结果仅作历史 evidence | alpha.5 真实陌生安装、发布 tag→tag 与 registry release 门禁 |
| Evidence-driven Evolution + internal Skill Opportunity | `implemented` | 自然 Goal→Host 复核/持久 Gap；跨 Goal Opportunity；缺失 Skill 的 exact Shadow/Retention/Promotion/Canary/Rollback 与[V4.49 最终包回滚生命周期](evidence/v4-49-missing-skill-canary-rollback-final-browser.zh.md)；existing-Skill 的完整 baseline、protected correction、whole-tree Candidate、paired Holdout/Retention、发布门、[V4.45 最终包浏览器](evidence/v4-45-existing-skill-release-final-browser.zh.md)、[V4.46 failed-Outcome Canary](evidence/v4-46-existing-skill-failed-outcome-canary.zh.md)、[V4.47 独立回滚门](evidence/v4-47-existing-skill-canary-control-rollback.zh.md)与[V4.48 最终包回滚生命周期](evidence/v4-48-existing-skill-canary-rollback-final-browser.zh.md)；历史 runtime 获取、static target、Draft、Shadow proposer 和旧编排均已删除，[V4.54](evidence/v4-54-remove-runtime-search-semantics.zh.md) 又移除活动 Case Pack/报告中的 `search` 命名；[V5.51](evidence/v5-51-long-term-effects-contract-2026-08-26.zh.md) 已提供长期事实域和只读指标投影 | 两套真实 provider、真实长期事实/paired epochs、长期误晋升/回滚数据缺失 |
| 双真实 Provider RP-1 | `not-run` | [V4.55](evidence/v4-55-real-provider-acceptance-gate.zh.md)：显式付费批准前零配置读取/零外部请求；不同 provider/authority/credential/model identity 预检；生产纵切编排；Candidate 盲区、assembled Holdout/Retention、composition、凭据脱敏与 terminal 不盲重试 hard gates；[V4.56](evidence/v4-56-bounded-governance-provider-requests.zh.md)又把两个治理 Provider seam 补齐 60 秒硬上限和 Host cancellation 组合；合同 8/8 与独立类型检查通过 | 当前 `NOT_RUN`；第二套独立 Provider、已授权真实 `passed` 结果和长期 outcome 均缺失；代码合同不等于真实模型证据 |
| 真实飞书 AS-2 验收入口 | `partial` | [V5.8](evidence/v5-8-real-feishu-acceptance-gate.zh.md)建立未授权零身份/凭据读取、clean revision、最终 tarball、官方 DSH CLI、生产 transport、exact 入站/回复/Command/Approval/notice、零 uncertain/failed、remove/readback 门；[V5.21](evidence/v5-21-real-feishu-native-schedule-gate.zh.md) 加入官方 Schedule；[V5.22](evidence/v5-22-resident-gateway-pairing.zh.md) 已从真实 App 完成 direct DM→code→Host approve、三次 native Session/回复和 Host 冷启动恢复；[V5.23](evidence/v5-23-resident-pairing-as2-gate.zh.md) 把 runner 改为零静态飞书 route、Host 动态 grant、十三项关闭门，不再要求 chat/user id；[V5.24](evidence/v5-24-resident-pairing-revocation.zh.md) 补齐 grant 撤销与 Web 二次确认；[V5.33](evidence/v5-33-real-feishu-pairing-timeout-2026-08-26.zh.md) 记录真实 epoch-3 等待配对码超时 | direct 主路径和若干 assembled 纵切有证据，但最新 epoch-4 为 `failed`；缺真实配对后新增消息、重启后新增消息、实际撤销重配、真实 Approval/Schedule、group policy、故障/长期重连和 Hermes paired |
| Existing-Skill Release + Canary | `implemented` | Release Gate 最终 tarball 已 verified；[V4.46](evidence/v4-46-existing-skill-failed-outcome-canary.zh.md) 增加 exact active release/failed Outcome/Retention replay、原生 Jobs、paid-uncertain 恢复、strict rollback eligibility 与无 mutation authority；[V4.47](evidence/v4-47-existing-skill-canary-control-rollback.zh.md) 增加 bounded Control/Remote/Web、人工确认和 expected-active rollback gate；[V4.48](evidence/v4-48-existing-skill-canary-rollback-final-browser.zh.md) 从最终包验证动作、断连保留、恢复、精确回滚、reload/冷重启和卸载；[V5.12](evidence/v5-12-existing-skill-automatic-promotion.zh.md) 增加 Workspace-only exact append-only/effect-clear/token-cache non-regression 自动门、durable decision/pointer crash recovery、原生 Jobs、只读 Web 状态，并从最终包验证自动晋升、断连保留、冷恢复和卸载 | 两套真实 provider、false-promotion/transfer 长期率与 Hermes paired |
| Existing-Skill Candidate-blind Holdout Evaluation | `implemented` | [V4.38](evidence/v4-38-existing-skill-candidate-blind-holdout-governance.zh.md) pre-Candidate 治理 + [V4.39](evidence/v4-39-existing-skill-exact-paired-holdout-evaluation.zh.md) exact Admission/baseline/Candidate/Envelope assembled paired Trial、四象限 verdict、输入漂移阻断、paid-uncertain 不盲重试、原生 Jobs 恢复、Host/Web 权威投影和最终 tarball 真实浏览器失败恢复/卸载 | 两套独立真实 provider与长期误晋升数据 |
| Existing-Skill Exact Retention Evaluation | `implemented` | [V4.40](evidence/v4-40-existing-skill-pre-candidate-retention-governance.zh.md) pre-Candidate Retention + [V4.41](evidence/v4-41-existing-skill-exact-retention-evaluation.zh.md) authoritative improved Holdout、exact 双树/两 Case Pack、四 Goal abstain、四象限、input rehash、paid-uncertain 不重试、原生 Jobs 与 Host 权威投影 + [V4.42](evidence/v4-42-existing-skill-retention-web-browser.zh.md) 最终 tarball 真实 Web reload/断连保留/恢复/卸载 + [V4.48](evidence/v4-48-existing-skill-canary-rollback-final-browser.zh.md) 最终包 Canary/rollback 恢复 | 真实 provider 和长期保持率 |
| Software Delivery P2A–P2D | `implemented` | 真实 Git、原生 Tool/Goal、Draft PR、checks；Outcome 只从 source-linked Session call/result pair 读取，经官方 durability checkpoint 后投影，并可在 cold Session start 幂等补记；[V5.17](evidence/v5-17-delivery-outcome-process-crash.zh.md) 以两个独立进程和真实 `SIGKILL` 验证 checkpoint 前与 checkpoint 后/Outcome 前窗口，冷恢复零模型/零 Tool replay/一次外部效果 | 真实长期任务、远端 reviewer 数据与同模型 Hermes paired |
| GitHub Review Follow-up P3.2 | `implemented` | exact-head allowlist、bounded follow-up、重启去重、cache parity | 真实 reviewer 返修闭环和多日 resident |
| Web Control Plane | `partial` | Control Center/Gateway/Feishu 的真实浏览器控制台与断线恢复见 [V5.27](evidence/v5-27-native-plugin-control-center.zh.md)；[V5.28](evidence/v5-28-evolution-surface-control-center.zh.md) 已把 `dsh-evolve-web` registration 迁到同一 child Surface；[V5.30](evidence/v5-30-evolution-surface-browser-2026-08-26.zh.md) 已通过 Evolution Surface；[V5.36](evidence/v5-36-doctor-control-surface-browser-2026-08-26.zh.md) 已通过 Doctor 断连/恢复；[V5.37](evidence/v5-37-telegram-control-surface-browser-2026-08-26.zh.md) 已通过 Telegram loopback Surface 刷新/reload；[V5.67](evidence/v5-67-control-center-keyboard-navigation-2026-08-28.zh.md) 已验证同页 ARIA tabs 键盘导航、刷新恢复、单标签和应用级 error 0 | Telegram 真实外部 Bot route、陌生用户可用性、真实 provider 价格与长期数据 |
| Exact 跨 Goal Skill 复用证据 | `verified` | [V4.50](evidence/v4-50-exact-cross-goal-skill-reuse.zh.md)：真实原生 Skill Tool、Session durability、active Goal、exact 内容哈希/Generation 分桶、持久重放；最终 tarball Web 2 uses/2 Goals、reload、Host 冷启动、合法 Session readback 与官方卸载 | 真实用户任务、Outcome/返工/成本因果、负迁移、保持率与 paired benchmark |
| Exact Skill 后续 Outcome 上下文 | `verified` | [V4.51](evidence/v4-51-exact-skill-outcome-context.zh.md)：同 Session/Goal/Generation 的 later durable Outcome、attempt/recovered/ambiguous latest、最新 metrics、全量 rollup/有界明细；最终 tarball Web 刷新、断连保留、冷恢复不重复与官方卸载 | 真实用户任务的因果效果、返工下降、长期负迁移/遗忘与 paired benchmark |
| Exact Skill 尝试间新增工作 | `verified` | [V4.52](evidence/v4-52-between-attempt-work-context.zh.md)：严格相邻次序、同源 Goal metrics、event seq/counter 单调门；ordered/measured/unmeasured/ambiguous 与 token/cache/latency/active-wall 差值；最终 tarball 的刷新、断连保留、冷恢复不重复、reload、卸载与无残留 | 真实用户任务、因果效果、返工下降与 paired benchmark |
| Exact Skill 失败上下文调查 | `verified` | [V4.53](evidence/v4-53-exact-skill-failure-context-investigation.zh.md)：两个不同 Goal 的唯一 latest failed 门、恢复/冲突 abstain、eligible 明细优先、Host/Control/Remote/Command/Web review-only 投影；最终 tarball 的 1 eligible/2 latest-failed、刷新、断连保留、冷恢复无重复、reload、官方卸载与原生 Web 无残留 | 因果复核、真实 provider、长期率与 paired benchmark |
| Runtime Readiness | `implemented` | 原生 Loader/Command；[V5.9](evidence/v5-9-doctor-channel-readiness.zh.md) 复用 Gateway 权威健康，覆盖飞书/Telegram 的 unavailable/connecting/ready/degraded/stopping、损坏快照 fail closed，以及最终 tarball degraded→reload→ready→remove 生命周期 | 真实渠道、多日故障、v0.1 全包诊断和陌生安装数据 |
| Telegram 单私聊 | `partial` | 已迁移 DSH Gateway；静态 exact route 与新增 resident pairing（unknown direct DM→一次性 code→Host approve→next-message native dispatch）；真实 DSH Workspace/Agent Loop、Commands、Approval、Goal/Schedule、Gateway durable ingress/outbound、cache parity、联合 tarball lifecycle；私有 Delivery Store 已删除；assembled long-poll failure→Gateway `degraded`→成功 poll→`ready`；[V5.7](evidence/v5-7-bounded-channel-delivery.zh.md)、[V5.140](evidence/v5-140-telegram-pairing-assembled-2026-09-04.zh.md)、[V5.144](evidence/v5-144-telegram-as1-real-contract-2026-09-04.zh.md) | 真实 Bot executor、陌生用户完整配对/回复/去重/Approval/重启/卸载和多日证据 |
| Evolve Channel Attention | `implemented` | Telegram/飞书 Candidate review/inactive promotion decision、concrete routes、显式 Workspace、durable notice、request parity；Evaluator Draft 表面已删除；进入十二包总装 | 真实渠道验证与多日移动端数据 |
| Goal Continuity | `implemented` | JSONL cold resume、SIGKILL、原生 Goal round limit | 多 Workspace 绑定、生产 soak |
| Resident OS unit | `implemented` | disabled Bundle、原生 `/resident`、exact hash/service-id 确认、无 bin tarball、十二包总装、launchd/systemd 与 macOS crash 测试 | Linux 真机和多日 soak |
| Workspace DSH Gateway | `implemented` | `dsh-gateway` 直接替换旧包且无兼容层；exact endpoint/Adapter account/routeIds deny-by-default；原生 Workspace/Session/Agent create/resume；持久 ingress/outbound 幂等与 uncertain 状态机；[V5.22](evidence/v5-22-resident-gateway-pairing.zh.md) 增加 Agent-before-auth、hashed pending code、Host Remote/Web approval、live Session/Workspace/cwd gate、原子动态 grant、跨重启匹配和零-route resident transport 健康，并从真实 rc.2 App 完成三次 ingress/outbound、零异常和 Host 冷启动恢复；[V5.24](evidence/v5-24-resident-pairing-revocation.zh.md) 增加原子撤销墓碑、活动 effect 门、Typert Remote 和动态/静态 route Web 控制；[V5.52](evidence/v5-52-gateway-long-term-observation-2026-08-26.zh.md) 增加脱敏终态事件并接入长期账本；[V5.57](evidence/v5-57-gateway-pending-request-control-2026-08-27.zh.md) 增加脱敏 pending request 与 request-id Host 审批；[V5.65](evidence/v5-65-gateway-pending-polling-2026-08-27.zh.md) 增加同页自动轮询且失败保留最后快照；[V5.66](evidence/v5-66-gateway-transport-activity-2026-08-27.zh.md) 增加连接/活动/错误时间可观测性；8 files / 36 tests、最终 tarball 升级/冷启动与单页浏览器控制面通过；[V5.1](evidence/v5-1-gateway-transport-health.zh.md)、[V5.2](evidence/v5-2-gateway-web-health.zh.md)、[V5.3](evidence/v5-3-feishu-native-image-ingress.zh.md)、[V5.7](evidence/v5-7-bounded-channel-delivery.zh.md) 继续成立 | 重启后新增消息、真实撤销重配、Approval/Schedule/group、渠道长期运行与 Hermes paired benchmark；通用文件需官方 DSH 内容契约 |
| 飞书 Adapter | `implemented` | [V5.22](evidence/v5-22-resident-gateway-pairing.zh.md)：Bundle boot 即注册 `pairedRoutes` 并连接官方 WebSocket；未知 DM 首条不进 Agent，回 code；Host批准后下一条动态采用 exact route；旧 `/feishu-pair`、临时 listener、反向短语/YAML/倒计时 UI 与测试净删除；真实 App 最终 tarball已完成 direct DM pairing、普通文本/原生 `/new`/普通文本三次 native 入站与回复，冷启动恢复 exact route/Session/journal/transport 且无重复投递；[V5.23](evidence/v5-23-resident-pairing-as2-gate.zh.md) 又让动态 route 进入 Host notice seam，并以 assembled DSH 验证 paired Approval `allowed-once` 与持久 notice；[V5.24](evidence/v5-24-resident-pairing-revocation.zh.md) 的 Gateway Web 已从最终包显示动态 grant 撤销二次确认；原有 Schedule、图片/Approval/内容读取证据继续覆盖静态 exact routes | 重启后新增消息、真实撤销重配、真实 Approval/Schedule/group/failure 与多日重连；普通文件/音视频仍 pending；内容能力还缺真实 App scope、资源权限拒绝和真实数据 |
| Hermes paired benchmark | `partial` | [V5.45](evidence/v5-45-hermes-deterministic-rerun-current-main-2026-08-26.zh.md) 在当前 `main`（`6e35477`）用独立 rc.5 checkout 重跑 EV-1、SD-1、LC-1、AS-1，退出码 0；前两项窄场景胜出，本机崩溃恢复与 Telegram 一次性审批均 0:0 平局；冻结 `result.json` 未改写 | 同模型真实编码、真实 Bot/App 消息交付、真实模型长任务、真实 provider 与长期 outcome 的 paired epochs |
| Registry release | `planned` | [V5.35](evidence/v5-35-machine-release-gates-2026-08-26.zh.md) 已提供机器可执行 gate manifest、阻断命令和 annotated-tag 入口，但当前 gates 仍为 blocked | 真实 Provider、完整飞书 AS-2、Hermes paired、长期效果证据和用户发布授权 |

## 当前可安装面

用户安装面已按[能力套件](capability-suites.zh.md)精简；下面的十二包清单是维护者审计和完整 clean-profile gate 的内部边界，不是用户必须逐项选择的产品菜单。

当前 `main` 增量通过根级 `pnpm check`（文档、全包 typecheck、测试和构建）；其中
`dsh-control-center` 2 files/4 tests、`dsh-gateway` 8 files/40 tests、`dsh-evolve-web` 2 files/27 tests、
`dsh-evolve-attention` 4 files/11 tests、`dsh-feishu` 18 files/46 tests、`dsh-evolve` 69 files/309 tests passed、
1 test skipped。Cache Contract 全通过；Doctor 十二包原生合同含新增 Control Center；十二包 clean-profile 最终 tarball 的 add/dump/boot/真实
Session+Goal+Storage+Tool/dispose/remove/reboot/readback 1/1（60.96 秒）；独立 Doctor packed
add/Loader/command/remove 1/1（10.35 秒）。V4.24 删除旧浏览器 acceptance fixture，并用 DSH Web 组件测试固定“纠正进入
自主内部治理、不出现路线选择”；V4.28 已用 test-only exact-lineage fixture 从最终 tarball 重跑完整评测视图的真实浏览器 reload/断连/恢复；V4.29 又从最终 tarball 验证 promotion eligible/blocked、失败保留、恢复和卸载；V4.48 从最终 tarball 验证 existing-Skill approve/promote/Canary/断连保留/rollback/reload/冷恢复/卸载，V4.49 验证 missing-Skill `skill-bundle` 的 promote/Canary/断连保留/root rollback/冷恢复/卸载，所有 fixture 均不进入发布包。

十二个包可生成 tarball 并通过 `dsh plugin --profile web add` 安装：`dsh-evolve`、`dsh-evolve-web`、`dsh-software-delivery`、`dsh-doctor`、`dsh-github-review`、`dsh-telegram`、`dsh-evolve-attention`、`dsh-goal-continuity`、`dsh-resident`、`dsh-gateway`、`dsh-feishu`、`dsh-control-center`。外部路由、自动恢复和 OS 部署默认关闭。没有任何 EvoForge 独立 Runtime、网站、daemon 或产品 CLI 是受支持入口。

## 当前限制

- 当前唯一支持目标是 DSH alpha.5 `db6bdc…`；rc.5/rc.2 只作历史 evidence。未知 revision、版本错配、tracked dirty 或更宽 peer range 都不能冒充兼容证据；
- v0.1 浏览器复验已完成；真实 provider cache-read/TTFT 仍需有预算的 paired soak；
- 自我发现只允许从 DSH 内部 Goal、Gap、失败、纠正、结果与复用证据学习；任何 Opportunity/Candidate/Retention/Canary verdict 自身都没有安装、激活或发布权。missing-Skill 的 Retention/Canary/Rollback 与 existing-Skill 的发布门/failed-Outcome Canary/独立 expected-active rollback gate 已实现；两条路径的最终包 rollback 浏览器恢复均已完成，真实 provider assembled 评估、长期负迁移/误回滚率和模型缺口质量仍缺；
- Hermes/OpenClaw/HanaAgent、论文、市场和开源实现只用于设计期调研与冻结 benchmark；运行时外部 Skill 搜索、获取、下载、导入或市场功能不属于本项目；
- 真实飞书 direct 文本/Command/回复已通过；重启后新增消息、撤销重配、Approval/Schedule/group、真实 Telegram/飞书 paired、真实 provider、陌生用户和生产多日证据仍缺失；assembled 图片链路不替代这些真实门禁；
- rc.5 与最新审计的 rc.2 都只有栅格图片附件契约；飞书普通文件和音视频尚未完成，且不得由 Gateway 私有扩展绕过。文档/知识库/云盘元数据/多维表格已有 assembled Tool 纵切，但真实 App scope、资源权限与真实内容尚未验证；
- 自动化 `implemented` 不能替代真实 outcome，也不能支持笼统的“优于 Hermes”；
- 不 merge、不发布 registry、不部署生产，除非用户另行授权。
完整命令、输出和支持决策见 [V5.72 证据](evidence/v5-72-latest-dsh-master-reaudit-2026-09-03.zh.md)。
## V5.107：发布预检与 scoped npm 名称解耦（本轮）

审计发现 `check-release.mjs` 以 `manifest.name` 拼接本地目录；未来迁移到合法 npm Scope 后会错误找不到
`packages/@scope/...`。本轮改为按 workspace 实际目录读取 manifest，同时保留公共元数据和 Bundle patch 校验。
最新 DSH preflight、文档/CI/套件/发布合同、全量 alpha.5 `pnpm run check` 均通过；未改名、未改 DSH、未绕过
npm 归属门。详见 [V5.107 证据](evidence/v5-107-release-check-scoped-name-safety-2026-09-04.zh.md)。
