# 2026-08-19 目标重新对齐审计

> 权威范围：当前 `main` / `origin/main`、全部已登记 worktree、本仓库源码、运行配置、测试与当前用户文档。本文记录事实和处理结论，不把计划写成完成证据。

## 结论

当前实现不是目标完成态。`dsh-gateway` 已直接替换旧 Router；旧 ClawHub/市场/运行时 research Candidate 已删除。本轮进一步确认公开 `dsh-evolve` 仍残留 Git repository/source、静态 Skill/Case Pack target 与按 Skill 自动晋升配置，先前“偏差已清除”的判断不完整；这些公开入口和活动装配现已删除，Git resolver 仅以零 source 的私有内容寻址 Bundle materializer 暂时隔离，仍须被完整 Bundle repository 替换。自我发现仍只以重复 Goal-linked Gap 决定 Opportunity 资格；纠正只从 feedback 目标回答的唯一 durable Skill invocation 和 exact Goal id/revision 精确关联，不宣称因果或资格影响。Gateway 公共普通文本 outbound/限流响应/健康、transport 聚合和统一只读 Web 已收敛；飞书 exact 消息、existing-Skill 再进化、完整内部归因、真实 provider 和 Hermes 同条件 paired evidence 仍缺失。

## 偏差与处置

| 范围 | 当前证据 | 判断 | 处置与完成证据 |
|---|---|---|---|
| 运行时能力获取与预选方向 | ClawHub、Agent Skills、research Candidate 已删除；本轮又删除公开 `sources[].repository/path`、`shadowTargets`、`evaluatorTargets`、`autoPromote.targets` 等配置及其活动装配；真实 Workspace/Session 测试已改用内部内容寻址 Bundle | **公开偏差已清除；私有遗留待删** | Config 负向契约固定只剩 cache/Workspace policy/supervisor；旧 Git resolver 现在硬编码零 source 且不能由 profile 重开，但源码、旧模块和历史 persistence shape 仍需继续删除/隔离 |
| 自我发现证据 | Opportunity 资格要求同 Workspace、同 Skill、两个不同 Goal-linked Gap；Opportunity v3 只按目标回答的唯一 durable Skill invocation/exact Goal 关联 correction，弱 same-Session 信号 abstain；delivery outcome 仍按 stable Goal identity 跨 revision 保守关联，固定 `causalClaim: none` | **部分实现** | 补 Delivery Outcome exact Skill invocation、existing-Skill improvement Opportunity/Candidate，以及返工、成本、跨 Goal 复用、Retention、负迁移和回滚 evidence；同 Goal retry、一次成功、模型自评继续 abstain；用真实 provider outcome 证明 |
| Candidate 治理 | Candidate schema 只允许 `internal-experience-v1` Opportunity、`bounded-model-authoring-v1`、`experience-authored-bundle-v1`；Admission/Lineage/Shadow 和 Web 已收敛到同一内部契约 | **边界已重建；整链验证未完成** | Candidate 保持 inactive/quarantined/unevaluated/never-executed；继续完成独立 final test、Shadow、Retention、future-Session promotion/rollback 与真实 provider 验证 |
| Gateway | `dsh-gateway` 已有 exact route、Workspace/Session/Agent 绑定、入站日志，以及 Telegram/飞书共用的普通文本 outbound intent/journal、按 account 串行、明确限流重试、uncertain 恢复、脱敏 transport observation 和同包只读 Web | **公共可靠性与 Web 已收敛；真实平台未完成** | 私有 Adapter Delivery Store/worker 已删除；平台 SDK/凭据/发送/卡片留在 Adapter；最终 tarball 的真实浏览器已覆盖刷新、Host 停机清空旧快照和恢复，本增量 clean-profile 已复验；继续补真实 exact 消息 |
| 飞书 | SDK WebSocket、pairing transport、DSH Web pairing/health 和测试路径存在 | **真实闭环未完成** | 完成 exact chat/user 入站、回复、文件/卡片、Command、Goal/Schedule/Approval、重启去重与最小权限真实验证 |
| DSH Web | Evolve 与飞书现有页面已能显示部分状态 | **覆盖不完整** | 增加权威 Gateway、内部 evidence、Candidate lineage/diff、baseline/holdout/Retention、成本/时延/cache、安全、晋升/隔离/回滚；真实浏览器验证刷新、失败和恢复 |
| 插件边界 | 当前十一包均为 DSH Bundle，Gateway 已改名；Evolve 仍有不再装配的静态 target/Git 模块和公开 Control 类型 | **正在重构** | 保留有独立用户结果的 Bundle；删除或收敛不再装配的浅模块，按 ADR-0049 固定 Gateway seam，按 ADR-0048/0066 固定内部自我发现领域 |
| Git | 审计起点 `main == origin/main == 85544b2`；22 个旧 feature worktree 对应分支均无 `main` 之外提交 | **提交已收敛，工作树未收敛** | 20 个 clean 旧 worktree 可删除；旧 `p0a-sealed-trial-ci` worktree 有未跟踪研究文件，旧 `v0.1-native-suite` worktree 有两处未提交测试修改，必须保留并单独审计；之后不创建新 branch/worktree |
| 发布证据 | 无 tag；现有 benchmark 主要是确定性窄 slice | **未达发布门禁** | clean-profile、故障注入、真实浏览器、真实飞书、真实 provider、长期 Retention/负迁移和同任务/模型/权限/预算 Hermes paired 全部达标后才打 annotated SemVer tag |

## 当前重构顺序

1. 用 `dsh-gateway` 替换旧 Router 包和所有消费者，保持已验证的 exact route/ingress 行为。
2. **进行中：**内部经验 Candidate 已替换混合 Discovery 存储；ClawHub/Agent Skills/research Candidate 和公开 Git/static-target 配置已删除，私有 Git resolver、旧 target 模块、Commands/Control 类型和历史 persistence shape 继续清理。
3. **部分完成：**Opportunity 已精确关联 durable correction invocation，并保守关联无因果声明的 outcome context；继续补 Delivery Outcome exact invocation、existing-Skill improvement、rework/cost/reuse/retention/negative-transfer/rollback，并打通真实 provider 独立评测、Shadow、Retention、晋升与回滚。
4. **部分完成：**Gateway 公共普通文本投递/限流响应/健康、transport 聚合和统一只读 Web 已收敛；继续补飞书真实消息闭环和完整 DSH Web 进化权威控制面。
5. 完成真实 provider 与 Hermes paired 验收；未达门禁前不打 tag、不宣布完成。
