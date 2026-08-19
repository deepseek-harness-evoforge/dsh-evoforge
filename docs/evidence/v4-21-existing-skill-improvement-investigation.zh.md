# V4.21 现有 Skill 精确版本改进调查证据

## 结论

`dsh-evolve` 现在能从 DSH 自身的明确纠正中发现“某个已安装 Skill 的同一模型可见内容版本在多个 Goal 中重复出现问题”，同时拒绝把它伪装成缺失能力 Opportunity 或可生成 Candidate 的完整基线。该增量是 existing-Skill 再进化的调查入口，不是完成的改进闭环。

## 证据与拒绝规则

- `DurableFeedbackAttribution` 对 user-explicit 和 model `skill` Tool 两条原生路径，哈希 durable Session 中模型实际收到的 Skill content blocks；同名但内容变化会得到不同 identity。
- 旧 v2 Feedback Signal 行保持可读；历史 attribution 没有 content hash 时只能展示，不能进入现有 Skill 改进聚类。
- `discoverImprovements()` 只接受同 Workspace、同 Skill 名、同 invocation-content hash、至少两个不同 Goal 的去重负向纠正；同 Goal retry、重复 Signal、版本漂移或证据不足均 abstain。
- 改进调查与重复 Gap 形成的 missing-Skill Opportunity 分轨。它固定 `waiting-for-baseline-bundle`、`causalClaim: none`、`releaseAuthority: none`，不被 Slow Loop、Evaluation Evidence Vault 或 capability-absent Envelope 消费。
- DSH Web 权威展示 Skill、调用内容 hash、跨 Goal/纠正数、证据引用、无因果边界和“等待完整基线 Bundle”；没有 Candidate、安装或发布动作。

## 自动化证据

- `durable-feedback-attribution.test.ts`：model Tool 与 user-explicit 两条路径产生精确 content hash，同名内容变化分流。
- `feedback-signal-monitor.e2e.test.ts`：新 identity 经真实 Storage Domain 持久化；旧无 hash 行仍可恢复。
- `skill-opportunity-discovery.test.ts`：跨 Goal 同版本形成调查；不同版本、同 Goal、legacy 和重复 Signal 均 abstain。
- `evolution-control-plane.test.ts`：Host 只投影有界调查数据与等待状态。
- `evolution-action.client.test.tsx`：Web 显示精确版本、Goal、引用、非因果和 Candidate 阻断原因。

## 已执行验证

- 定向核心与控制面：4 files、27 tests 通过；Web client：1 file、24 tests 通过。
- `dsh-evolve` 与 `dsh-evolve-web` typecheck 通过；固定 DSH revision 的 Typert 生成物已刷新并通过 freshness gate。
- 根级 `pnpm check` 退出 0：文档、十一包 typecheck、全测试和全构建通过；`dsh-evolve` 64 files、308 tests passed、2 skipped，`dsh-evolve-web` 2 files、26 tests passed。
- `pnpm test:cache-contract` 全通过：64-turn Gap Tool、GitHub Review composition、Goal cold resume、assembled delivery、飞书完整渠道 composition，以及十一包原生合同 22/22。
- 十一包最终 tarball clean-profile add/dump/boot、真实 Session/Goal/Storage/Tool、dispose/remove/reboot/readback 1/1 通过（32.68 秒）；Doctor packed add/Loader/command/remove 1/1 通过（3.55 秒）。
- 从当前源码重建 browser acceptance bundle 后，真实浏览器显示唯一且有布局的改进调查标题（`526×14`）；exact version 与等待完整 Bundle 文案刷新后仍各 1 条，页面 diagnostics 为 `[]`，`ClawHub/Marketplace/Agent Skills/Skill acquisition` 均不存在。

## 仍缺

模型可见 invocation hash 不是完整 Skill package identity。后继必须在调用时从受信 Provider 安全物化并封存完整 Bundle（含允许的资源），证明其与调用内容一致，再建立 skill-tree baseline、受保护 author/admission/holdout、Candidate、Retention、canary 和 future-Session-only 晋升。真实 provider、真实飞书、长期负迁移与 Hermes paired 仍未完成。
