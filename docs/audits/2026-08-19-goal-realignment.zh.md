# 2026-08-19 目标重新对齐审计

> 权威范围：当前 `main` / `origin/main`、全部已登记 worktree、本仓库源码、运行配置、测试与当前用户文档。本文记录事实和处理结论，不把计划写成完成证据。

## 结论

当前实现不是目标完成态。`dsh-gateway` 已直接替换旧 Router；旧“能力获取/运行时研究生成 Candidate”的活动源码、依赖、持久化变体、Web 类型和当前测试已经删除，历史证据已隔离为撤销记录。自我发现仍只以重复 Goal-linked Gap 决定 Opportunity 资格，但已保守关联同 Session 唯一 Skill 的明确纠正和同一稳定 Goal id 跨 revision 的唯一 Skill 交付结果，并明确不宣称因果或资格影响；完整内部归因仍未完成。Gateway 公共 outbound/限流/健康、飞书 exact 消息、内部 Candidate 的独立评测整链、真实 provider 和 Hermes 同条件 paired evidence 仍缺失。

## 偏差与处置

| 范围 | 当前证据 | 判断 | 处置与完成证据 |
|---|---|---|---|
| 运行时能力获取 | `trusted-skill-discovery.ts`、Agent Skills archive/index、local trusted source、`skill-research.ts`、research Holdout/revision、zip 获取依赖及对应活动测试已删除；新 `evoforge_skill_candidates` Domain 只接受内部 Opportunity 生成的 canonical text bundle | **偏差已清除；需持续防回归** | Candidate Repository 无 search/import/install/activate/release interface；旧存储变体不读取、不迁移；负向契约测试拒绝旧 external/source/research shape；历史报告明确标记撤销 |
| 自我发现证据 | Opportunity 资格要求同 Workspace、同 Skill、两个不同 Goal-linked Gap；Opportunity v2 已按唯一 Session Skill / stable Goal identity 跨 revision 保守关联纠正引用和 compact delivery outcome，歧义、早到或 revision 倒退事件 fail closed，固定 `causalClaim: none` | **部分实现** | 补 exact invocation 因果链接以及返工、成本、跨 Goal 复用、Retention、负迁移和回滚 evidence；同 Goal retry、一次成功、模型自评继续 abstain；用真实 provider outcome 证明 |
| Candidate 治理 | Candidate schema 只允许 `internal-experience-v1` Opportunity、`bounded-model-authoring-v1`、`experience-authored-bundle-v1`；Admission/Lineage/Shadow 和 Web 已收敛到同一内部契约 | **边界已重建；整链验证未完成** | Candidate 保持 inactive/quarantined/unevaluated/never-executed；继续完成独立 final test、Shadow、Retention、future-Session promotion/rollback 与真实 provider 验证 |
| Gateway | `dsh-channel-router` 已有 exact route、Workspace/Session/Agent 绑定、入站日志、去重和 uncertain 恢复，Telegram/飞书均消费 | **模块命名与深度不足** | 本增量直接替换为 `dsh-gateway`，不保留转发包；后续把确属跨 Adapter 的 outbound intent、限流、诊断/健康投影收敛进 Gateway，同时把平台 SDK/凭据/UI 留在 Adapter；clean-profile add/dump/boot/remove 和双渠道真实路径证明 |
| 飞书 | SDK WebSocket、pairing transport、DSH Web pairing/health 和测试路径存在 | **真实闭环未完成** | 完成 exact chat/user 入站、回复、文件/卡片、Command、Goal/Schedule/Approval、重启去重与最小权限真实验证 |
| DSH Web | Evolve 与飞书现有页面已能显示部分状态 | **覆盖不完整** | 增加权威 Gateway、内部 evidence、Candidate lineage/diff、baseline/holdout/Retention、成本/时延/cache、安全、晋升/隔离/回滚；真实浏览器验证刷新、失败和恢复 |
| 插件边界 | 当前十一包均为 DSH Bundle，但 `dsh-channel-router` 命名错误，Evolve 内部模块过多沿用 Discovery/Research 词汇 | **需要重构** | 保留有独立用户结果的 Bundle；内部流水线维持深模块；按 ADR-0049 重建 Gateway 接缝，按 ADR-0048 重建自我发现领域 |
| Git | 审计起点 `main == origin/main == 85544b2`；22 个旧 feature worktree 对应分支均无 `main` 之外提交 | **提交已收敛，工作树未收敛** | 20 个 clean 旧 worktree 可删除；旧 `p0a-sealed-trial-ci` worktree 有未跟踪研究文件，旧 `v0.1-native-suite` worktree 有两处未提交测试修改，必须保留并单独审计；之后不创建新 branch/worktree |
| 发布证据 | 无 tag；现有 benchmark 主要是确定性窄 slice | **未达发布门禁** | clean-profile、故障注入、真实浏览器、真实飞书、真实 provider、长期 Retention/负迁移和同任务/模型/权限/预算 Hermes paired 全部达标后才打 annotated SemVer tag |

## 当前重构顺序

1. 用 `dsh-gateway` 替换旧 Router 包和所有消费者，保持已验证的 exact route/ingress 行为。
2. **已完成：**用内部经验 Candidate 契约替换混合 Discovery 存储，删除能力获取、Agent Skills 和 research Candidate 活动代码路径。
3. **部分完成：**Opportunity 已关联无因果声明的 correction/outcome context；继续补 exact invocation、rework/cost/reuse/retention/negative-transfer/rollback，并打通独立评测、Shadow、Retention、晋升与回滚。
4. 补 Gateway 公共投递/限流/健康、飞书真实消息闭环和 DSH Web 权威控制面。
5. 完成真实 provider 与 Hermes paired 验收；未达门禁前不打 tag、不宣布完成。
