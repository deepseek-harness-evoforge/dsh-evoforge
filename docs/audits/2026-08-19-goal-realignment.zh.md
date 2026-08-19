# 2026-08-19 目标重新对齐审计

> 权威范围：当前 `main` / `origin/main`、全部已登记 worktree、本仓库源码、运行配置、测试与当前用户文档。本文记录事实和处理结论，不把计划写成完成证据。

## 结论

当前实现不是目标完成态。主运行组合已经停止外部 Skill 搜索和 Web research，但领域模型、持久化契约、源码、测试及部分权威文档仍被旧“能力获取/研究生成 Candidate”方案污染；`dsh-channel-router` 只覆盖了 Gateway 的入站内核；飞书 exact 消息、内部 Candidate 的独立评测整链、真实 provider 和 Hermes 同条件 paired evidence 仍缺失。

## 偏差与处置

| 范围 | 当前证据 | 判断 | 处置与完成证据 |
|---|---|---|---|
| 运行时能力获取 | `trusted-skill-discovery.ts`、Agent Skills archive/index、local trusted source、`skill-research.ts`、research Holdout/revision 及对应测试仍存在；当前 `index.ts` 已不再组合网络发现 | **偏差；未删除** | 新建只接受内部 DSH 经验的 Candidate 模块和存储；重写 admission/lineage/Web 类型；删除上述获取/研究实现、依赖和当前测试；源码与打包产物不得再出现运行时外部获取接口 |
| 自我发现证据 | 当前 Opportunity 只要求同 Workspace、同 Skill、两个不同 Goal-linked Gap | **部分实现** | 把纠正、真实 outcome、返工、成本、跨 Goal 复用、Retention、负迁移和回滚纳入可归因 evidence；同 Goal retry、一次成功、模型自评继续 abstain；用跨 Goal fixtures 与真实 provider outcome 证明 |
| Candidate 治理 | whole-Skill v1 已 inactive/quarantined/unevaluated/never-executed；但类型仍允许 local Git、Agent Skills、research v2/v3 | **偏差；契约过宽** | Candidate schema 只允许 `dsh-experience` 来源和内部 evidence identity；治理面只接收 content-addressed bundle；独立 final test、Shadow、Retention、future-Session promotion/rollback 全链验证 |
| Gateway | `dsh-channel-router` 已有 exact route、Workspace/Session/Agent 绑定、入站日志、去重和 uncertain 恢复，Telegram/飞书均消费 | **模块命名与深度不足** | 本增量直接替换为 `dsh-gateway`，不保留转发包；后续把确属跨 Adapter 的 outbound intent、限流、诊断/健康投影收敛进 Gateway，同时把平台 SDK/凭据/UI 留在 Adapter；clean-profile add/dump/boot/remove 和双渠道真实路径证明 |
| 飞书 | SDK WebSocket、pairing transport、DSH Web pairing/health 和测试路径存在 | **真实闭环未完成** | 完成 exact chat/user 入站、回复、文件/卡片、Command、Goal/Schedule/Approval、重启去重与最小权限真实验证 |
| DSH Web | Evolve 与飞书现有页面已能显示部分状态 | **覆盖不完整** | 增加权威 Gateway、内部 evidence、Candidate lineage/diff、baseline/holdout/Retention、成本/时延/cache、安全、晋升/隔离/回滚；真实浏览器验证刷新、失败和恢复 |
| 插件边界 | 当前十一包均为 DSH Bundle，但 `dsh-channel-router` 命名错误，Evolve 内部模块过多沿用 Discovery/Research 词汇 | **需要重构** | 保留有独立用户结果的 Bundle；内部流水线维持深模块；按 ADR-0049 重建 Gateway 接缝，按 ADR-0048 重建自我发现领域 |
| Git | 审计起点 `main == origin/main == 85544b2`；22 个旧 feature worktree 对应分支均无 `main` 之外提交 | **提交已收敛，工作树未收敛** | 20 个 clean 旧 worktree 可删除；旧 `p0a-sealed-trial-ci` worktree 有未跟踪研究文件，旧 `v0.1-native-suite` worktree 有两处未提交测试修改，必须保留并单独审计；之后不创建新 branch/worktree |
| 发布证据 | 无 tag；现有 benchmark 主要是确定性窄 slice | **未达发布门禁** | clean-profile、故障注入、真实浏览器、真实飞书、真实 provider、长期 Retention/负迁移和同任务/模型/权限/预算 Hermes paired 全部达标后才打 annotated SemVer tag |

## 当前重构顺序

1. 用 `dsh-gateway` 替换旧 Router 包和所有消费者，保持已验证的 exact route/ingress 行为。
2. 用内部经验 Candidate 契约替换混合 Discovery 存储，删除能力获取、Agent Skills 和 research Candidate 代码路径。
3. 将内部 evidence 扩展为 outcome/correction/rework/cost/reuse/retention，并打通独立评测、Shadow、Retention、晋升与回滚。
4. 补 Gateway 公共投递/限流/健康、飞书真实消息闭环和 DSH Web 权威控制面。
5. 完成真实 provider 与 Hermes paired 验收；未达门禁前不打 tag、不宣布完成。
