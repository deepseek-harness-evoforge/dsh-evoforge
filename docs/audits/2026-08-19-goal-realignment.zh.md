# 2026-08-19 目标重新对齐审计

> 权威范围：当前 `main` / `origin/main`、全部已登记 worktree、本仓库源码、运行配置、测试与当前用户文档。本文记录事实和处理结论，不把计划写成完成证据。

## 结论

当前实现不是目标完成态。`dsh-gateway` 已直接替换旧 Router；旧 ClawHub/市场/运行时 research Candidate 已删除。`dsh-evolve` 的 Git source/ref、静态 Skill/Case Pack/Feedback/Evaluator target、Feedback/Evaluator Draft、Shadow 内 proposer、自动 review expiry、旧 Retention/canary 和对应 Control/Web/attention 表面已从活动源码物理删除；`GenerationBundleRepository` 只接收内部 exact Bundle，legacy artifact 在 Provider 边界 quarantine。Shadow 只消费内容寻址、lineage 完整、DSH-assembled 的 exact Candidate，自身模型调用为零。自我发现仍只以重复 Goal-linked Gap 决定 Opportunity 资格；纠正只从 feedback 目标回答的唯一 durable Skill invocation 和 exact Goal id/revision 精确关联，不宣称因果或资格影响。Gateway 公共普通文本 outbound/限流响应/健康、transport 聚合和统一只读 Web 已收敛；飞书 exact 消息、existing-Skill 再进化、内部 Retention/canary/outcome、真实 provider 和 Hermes 同条件 paired evidence 仍缺失。

## 偏差与处置

| 范围 | 当前证据 | 判断 | 处置与完成证据 |
|---|---|---|---|
| 运行时能力获取与预选方向 | ClawHub、Agent Skills、research Candidate、source/target 配置、Git materializer/ref、Feedback/Evaluator Draft 与 Shadow proposer 均已删除；活动 Provider/Publisher/Shadow 只接收 exact internal Bundle/Candidate | **活动路径与历史源码已清除** | Config、Shadow source 和 packed runtime 负向契约已固定；legacy persistence 只读 quarantine；[V4.24](../evidence/v4-24-exact-candidate-shadow-cleanup.zh.md) 记录物理删除证据 |
| 自我发现证据 | Opportunity 资格要求同 Workspace、同 Skill、两个不同 Goal-linked Gap；Opportunity v3 只按目标回答的唯一 durable Skill invocation/exact Goal 关联 correction，弱 same-Session 信号 abstain；delivery outcome 仍按 stable Goal identity 跨 revision 保守关联，固定 `causalClaim: none` | **部分实现** | 补 Delivery Outcome exact Skill invocation、existing-Skill improvement Opportunity/Candidate，以及返工、成本、跨 Goal 复用、Retention、负迁移和回滚 evidence；同 Goal retry、一次成功、模型自评继续 abstain；用真实 provider outcome 证明 |
| Candidate 治理 | Candidate schema 只允许内部 Opportunity、内容寻址 whole-Skill Bundle 和 exact lineage；author、治理与执行面隔离；Shadow 不提案，只运行 exact Candidate | **边界已重建；整链验证未完成** | Candidate 保持 inactive/quarantined/unevaluated/never-executed；按内部 Envelope/Outcome 重建 Retention/canary，完成真实 provider 与 future-Session promotion/rollback 长期验证 |
| Gateway | `dsh-gateway` 已有 exact route、Workspace/Session/Agent 绑定、入站日志，以及 Telegram/飞书共用的普通文本 outbound intent/journal、按 account 串行、明确限流重试、uncertain 恢复、脱敏 transport observation 和同包只读 Web | **公共可靠性与 Web 已收敛；真实平台未完成** | 私有 Adapter Delivery Store/worker 已删除；平台 SDK/凭据/发送/卡片留在 Adapter；最终 tarball 的真实浏览器已覆盖刷新、Host 停机清空旧快照和恢复，本增量 clean-profile 已复验；继续补真实 exact 消息 |
| 飞书 | SDK WebSocket、pairing transport、DSH Web pairing/health 和测试路径存在 | **真实闭环未完成** | 完成 exact chat/user 入站、回复、文件/卡片、Command、Goal/Schedule/Approval、重启去重与最小权限真实验证 |
| DSH Web | Evolve 与飞书现有页面已能显示部分状态 | **覆盖不完整** | 增加权威 Gateway、内部 evidence、Candidate lineage/diff、baseline/holdout/Retention、成本/时延/cache、安全、晋升/隔离/回滚；真实浏览器验证刷新、失败和恢复 |
| 插件边界 | 当前十一包均为 DSH Bundle，Gateway 已改名；Evolve 历史静态 target/Git/Draft/Retention/canary 模块和旧 Control/Web/attention 类型已删除 | **当前边界已收敛** | 保留有独立用户结果的 Bundle；按 ADR-0049 固定 Gateway seam，按 ADR-0048/0066/0068 固定内部自我发现与 exact-Candidate Shadow 领域 |
| Git | 审计起点 `main == origin/main == 85544b2`；22 个旧 feature worktree 对应分支均无 `main` 之外提交 | **提交已收敛，工作树未收敛** | 20 个 clean 旧 worktree 可删除；旧 `p0a-sealed-trial-ci` worktree 有未跟踪研究文件，旧 `v0.1-native-suite` worktree 有两处未提交测试修改，必须保留并单独审计；之后不创建新 branch/worktree |
| 发布证据 | 无 tag；现有 benchmark 主要是确定性窄 slice | **未达发布门禁** | clean-profile、故障注入、真实浏览器、真实飞书、真实 provider、长期 Retention/负迁移和同任务/模型/权限/预算 Hermes paired 全部达标后才打 annotated SemVer tag |

## 当前重构顺序

1. 用 `dsh-gateway` 替换旧 Router 包和所有消费者，保持已验证的 exact route/ingress 行为。
2. **已完成当前边界清理：**内部经验 Candidate 已替换混合 Discovery 存储；ClawHub/Agent Skills/research Candidate、Git/static-target 配置与 resolver/ref、Feedback/Evaluator Draft、Shadow proposer、旧 Retention/canary 和 Control/Web/attention 表面已物理删除；legacy persistence 固定为只读 quarantine。
3. **部分完成：**Opportunity 已精确关联 durable correction invocation，并保守关联无因果声明的 outcome context；继续补 Delivery Outcome exact invocation、existing-Skill improvement、rework/cost/reuse/retention/negative-transfer/rollback，并打通真实 provider 独立评测、Shadow、Retention、晋升与回滚。
4. **部分完成：**Gateway 公共普通文本投递/限流响应/健康、transport 聚合和统一只读 Web 已收敛；继续补飞书真实消息闭环和完整 DSH Web 进化权威控制面。
5. 完成真实 provider 与 Hermes paired 验收；未达门禁前不打 tag、不宣布完成。
