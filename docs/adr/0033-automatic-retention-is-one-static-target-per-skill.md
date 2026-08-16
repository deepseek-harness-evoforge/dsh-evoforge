# ADR-0033：自动 Retention 每个 Skill 只绑定一个静态 exact Target

## 状态

Accepted，2026-08-17。

## 背景

P1.11 能执行历史能力检查，P1.12 能把结果作为自动晋升门，但每个 clear-win Candidate 仍要求操作者
手工拼接 CLI。常驻自进化因此会停在一个机械步骤上。直接建设 Case Registry、历史选择算法、quorum、
预算调度或 durable queue 会显著增加概念和故障面，而且尚无真实数据证明这些策略有通用需求。

Retention evaluator 可能通过 assembled DSH 产生模型调用，因此自动执行也是潜在付费动作；不能仅因
Candidate 看起来优秀就推断用户已授权。

## 决策

允许部署者在 `autoPromote.retentionTargets` 中为一个 allowlisted Skill 配置至多一个
`Retention Target`：公开稳定 id、exact Skill、独立 prior Case Pack 路径与 hash、以及既有
`retentionRoots` 中的一个 owned output root。声明 Target 本身就是该 exact evaluator 的部署策略授权。

既有 supervisor 每轮先筛选原本已通过 P1.1 的 Candidate，再检查 P1.12 evidence。只有 evidence
确实 missing 且无 warning 时，才通过原生 DSH Jobs 执行一个 P1.11 Retention；每轮最多一个。
`retained` 随即进入既有自动 policy，`regressed|incomplete` 留在 review。human disposition、已激活
Candidate、未满足 clear-win 的 Candidate 均不产生费用。

output identity 由 exact Candidate、Target id 和 Case Pack hash 导出。Trial 一旦创建 output 后发生
崩溃或结果不确定，常驻扫描不得自动重试；操作者异步检查或使用新的 Target/version，原 Session 从不
等待。操作者在 output 创建前取消 native Job 时，该 Candidate 在当前 DSH 进程内同样被抑制；重启后
因尚无 effect 可以重新评估。开始 Trial 前的纯验证错误可以在配置修正后重试，因为尚未产生 evaluator effect。

## 边界与后果

- 一个 Skill 只有一个 Target；多个旧能力先由一个经过资格验证的 Case Pack 表达；
- 不自动生成、挑选、合并或淘汰 Case Pack，不引入 registry/quorum/DAG/第二个 daemon；
- Target 只来自 host config；Command、Remote、Web 和模型不能提交 path、hash 或成本参数；
- normal Session 不新增 Tool、Prompt、Skill、system message 或 token；
- 每个 Candidate 固定四次 evaluator execution；assembled evaluator 的模型费用按其自身报告计算；
- 显式 human approve/promote 仍是独立授权，不被实验性 Target 改写。

## 拒绝方案

- **自动跑所有历史 Pack**：成本无界，并提前引入选择、冲突和过期平台；
- **让模型决定跑哪个 Pack**：选择本身增加 token，且不能授权付费动作；
- **每个 Skill 多 Target + quorum**：首片没有数据决定 all/any/required 语义；
- **崩溃后自动重试**：可能重复模型费用，违反 Uncertain External Effect 规则；
- **新增 Retention daemon/queue**：既有 run output、supervisor 与 native Jobs 已覆盖事实、连续性和观察。
