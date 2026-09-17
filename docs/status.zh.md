# 当前状态

更新时间：2026-09-17。本文区分已部署真实路径、局部实现和未取得的效果证据；历史验收不随本页改写。
状态词见 [Hermes 对照记分卡](architecture/hermes-replacement-scorecard.zh.md)。

## 总结

项目仍是 pre-alpha，尚不能宣称整体替代 Hermes。单一生产 Host 已升级到 DSH `0.1.6-alpha.1` /
`0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`。Web 旧会话回读、飞书附件下载与冷重启续接已有真实证据。
这不是完整渠道矩阵、可靠自我进化或模型质量比较通过；未发布 registry 包或通过全部门禁的 release tag。

## 当前矩阵

| 范围 | 当前结论 | 未闭合边界 |
| --- | --- | --- |
| DSH 兼容与安装 | 固定新版核心及原生依赖已部署；完整 build/typecheck/test、兼容矩阵、历史副本迁移和官方安装路径通过 | 不是未来版本兼容声明；追加新消息后不能只换回旧核心 |
| Web | 原会话实际文件回读与重启恢复通过；子页刷新、重挂载、会话隔离、断线提示与恢复已部署实测 | blank Session/onboarding 原生 slot 边界仍存在；非全部任务状态验收 |
| Gateway / Feishu | 私聊原生 read/present 实际交付 131 字节附件，平台下载哈希一致；重启回读成功、无重复发送 | 群聊、审批、计划、撤销和长期重连尚未形成同一轮完整真实发布矩阵 |
| Telegram | Adapter、pairing 和安全合同有 assembled 证据 | 真实 Bot AS-1 未完成 |
| Evolution | Candidate、隔离评测、future-Session 固定与回滚有局部合同 | 普通无 Goal 纠正尚未贯通慢环；未见任务实际收益未证明 |
| Provider 进化验收 | RP-1 epoch 2 资格检查在读取 Provider 配置前拒绝不完整 attestation | runtime-attestation-incomplete；真实聊天不能替代进化验收 |
| Delivery / continuity | 安装、原生 Session/Goal/Storage 移除读回及局部恢复合同通过 | 不外推所有附加套件或长期效果 |
| Hermes paired | 有冻结 deterministic/assembled 切片 | 同任务、模型、权限、预算的实际质量优势仍 not-measured |
| Registry / release | 未发布 | 完整 required gates 未通过 |

## 已关闭的真实问题

- 核心迁移、旧会话真实回读与历史保护见
  [9 月 16 日部署验收](evidence/2026-09-16-native-core-deployment-and-feishu-present.zh.md)。
  其中附件失败是当日事实，当前附件状态以下一条为准。
- 把 Web present 成功误称为飞书送达的问题已修复。原私聊实际收到附件，下载字节一致，重启回读后账本仍仅一次发送，
  见 [9 月 17 日文件验收](evidence/2026-09-17-feishu-full-access-delivery.zh.md)。凭据、配对与原生完全访问权限未改变。
  该轮 16 秒、31.2K tok 仅为单次记录，不是性能或成本优势。
- 刷新控制台丢失子页的问题已修复；会话隔离和断线后自动恢复通过，
  见 [9 月 17 日控制台验收](evidence/2026-09-17-control-center-view-recovery.zh.md)。
  此前“当前 profile 未验证”“生产仍为 alpha.5”“EACCES 阻止主要路径”的概括已过时；没有因此修改历史文件权限。

## 普通纠正链路的实际缺口

9 月 17 日按当前生产入口源码核对：

1. `feedback-signal-monitor.ts` 监听原生 message feedback，投影 negative-with-note；它不是自然语言返工消息识别器。
2. `skill-opportunity-discovery.ts` 的现有 Skill 改进机会仍要求 exact invocation content 和
   `two-or-more-distinct-goals-same-invocation-content`。不能要求普通聊天先创建 Goal 来冒充交互优先。
3. `index.ts` 把无 Goal Gap 保留为 signal，不触发旧 authoring reconcile。独立 Interaction resolver 仅组合局部
   Workspace/Generation/Routing 证据，返回 `evidence-unavailable`，没有提供完整运行时 attestation。

“收到纠正”“记录 signal”“生成候选”“未见任务改善”是不同验收点。不能删除 Goal 检查或把一句纠正当作充分因果
证据来接通晋升，也不能用 fixture 成功声明运行时已经学会。

## 下一退出门（按用户优先级）

1. 扩大固定真实任务的正确率、完成度、人工干预、耗时和 token 记录；优先修结果不完整、半途停止、失败却报成功。
   复用已通过的 Web/飞书路径，不重复迁移核心或修已关闭的子页问题。
2. 贯通一个普通纠正的最小纵向切片：原生消息与具体失败/修复证据关联，形成 inactive Skill 候选，再经 proposer
   不能改写的独立 baseline/candidate、未见 holdout 和 retention。不足则 abstain，当前 Session 不漂移且可精确回滚。
3. 补齐真实渠道审批、恢复和不确定外部效果矩阵；保持单一 Host，不扩大授权、不盲目重发。
4. 同任务/模型/权限/预算比较 Hermes，仅对证据充分的具体工作流声明更好；最后进入 release/registry 门禁。

插件恢复、Skill Generation 回滚和核心降级是不同操作。新核心追加历史后，不得仅换旧二进制或恢复旧快照而静默
丢弃新消息；保留当前核心与数据，使用兼容插件恢复或关闭对应外发能力。
