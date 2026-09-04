# Hermes 对照验收记分卡

本文定义如何诚实地说“DSH + EvoForge 是 Hermes 的上位替代”。它不是功能清单，也不把本地 mock、单测或一次
成功当成 better。

## 1. 状态含义

| 状态 | 含义 |
| --- | --- |
| designed | 目标、边界和验收方法已写清 |
| implemented | 代码具备该路径，但尚未完成真实门禁 |
| verified | 在声明的同一 revision、模型、权限、预算和环境下可复现通过 |
| better | 与 Hermes paired 对照中不劣，且至少一个预先声明的主指标更好 |
| partial / blocked / not-measured | 范围有限、被阻断或没有数据，不能升级 |

“整体上位替代”只有在每个对外声明的 Hermes 工作流都达到 verified，且至少一个核心工作流达到 better 时才可使用。
一个渠道或一个窄切片胜出，不覆盖未测范围。

## 2. 工作流矩阵

| 工作流 | EvoForge 设计 | 当前实现/证据 | 发布前必须补齐 |
| --- | --- | --- | --- |
| 普通对话与渐进式 Skill | 保持 DSH 原生对话和能力解析；Goal 可选 | implemented；DSH 原生 Session 路径已有 | 真实用户长时复用、误调用和人工干预数据 |
| Resident Gateway 与配对 | 单 Host、首条私聊配对、下一条进入原生 Session、幂等投递 | assembled/局部真实 smoke | Feishu/Telegram 完整 AS、重启新增消息、撤销、长期重连 |
| 软件交付 | 原生 Agent/Goal/Approval + 隔离验证 + Draft PR | 本地 assembled 已有 | 同条件 Hermes SD paired、真实 repo/权限与多日 soak |
| 崩溃恢复 | 原生 Session/Goal/Jobs，journal 恢复，未知结果不重试 | LC slice 已有 | 真实模型、跨进程外部效果和长期恢复率 |
| 自我进化 | signal→gap/investigation→isolated Candidate→holdout/retention→future Session | 本地合同和 deterministic EV slice | 两套真实 Provider、未见样本、负迁移/遗忘/误晋升长期数据 |
| 人工治理与回滚 | 三平面隔离、approve/reject/promote/rollback、精确 pointer | Host/Web 局部验证 | 真实浏览器失败/恢复、权限审计、canary 反事实结果 |
| Web 控制面 | 一个 Session-scoped conversation.view、按套件显示空态 | 原生 surface 局部验证 | clean profile 首次 Session、刷新/401/断线/恢复和单页操作 |
| Cache 与成本 | 固定模型可见 composition，记录 token/latency/cache-read | 合同级检查 | 真实 Provider 的 cache-read、货币成本和跨任务统计 |

## 3. Paired benchmark 规则

每个 slice 必须锁定：

- 同一任务、材料和隐藏验收；
- 同一 DSH revision、EvoForge commit 和 Hermes revision；
- 同一模型、权限、工具、预算、网络和超时；
- 同一失败注入和重启时序；
- baseline/candidate 仅在被测能力内容上有差异。

至少记录成功率、首次成功、人工选路/干预、Skill 发现与误调用、跨任务复用、负迁移、遗忘、误晋升、恢复、
重复外部效果、token、时延、cache-read、费用（有真实计价时）和精确回滚。缺少任一关键指标时标记 not-measured。

## 4. 当前结论

当前仓库有 EV-1、SD-1、LC-1、AS-1 的确定性/assembled harness，以及局部真实飞书 smoke；这些证明边界和
生命周期，不证明模型质量或整体替代。最新 DSH canonical 安装通过但根构建被上游 dsh-root 类型入口阻断；可
构建支持基线仍为 alpha.5。真实 Provider、完整渠道验收和长期 paired 数据未齐，当前结论是 partial，不能发布
“Hermes 上位替代”。

基准入口和冻结 epoch 见 [benchmarks/README](../../benchmarks/README.md)；当前状态和证据见
[evidence 索引](../evidence/README.zh.md)。
