# V4-3 跨 Goal Capability Gap 需求聚类证据

> 历史演进证据：本页的 external Candidate resolution/cluster 算法已删除，不代表当前产品状态。当前同 Workspace、同 Skill、跨 Goal 规则由 `SkillOpportunity` 表达，见 [V4-8](v4-8-internal-skill-opportunity-discovery.zh.md) 与 [V4-9](v4-9-internal-skill-candidate-boundary.zh.md)。

> 状态：implemented evidence
> 日期：2026-08-18
> 边界：证明 durable Gap 可以在不调用模型、不污染当前 Session 的情况下形成保守、可解释的跨 Goal 需求证据；不证明聚类已经能自动搜索网络、生成 Skill 或完成慢环。

## 用户结果

EvoForge 不再把每次缺口当成彼此无关的一次失败，也不会因为同一个 Goal retry 多次就误判为高需求。Host
会从已经确认并持久化的 Capability Gap 中，找出同一 Workspace 内至少两个不同 Goal 反复需要的能力。

两个 Goal 使用不同 Gap name 时，只有 trusted discovery 已经分别把它们收敛到同一个 quarantined Skill
identity，系统才把它们放进同一 cluster。DSH Web 展示独立 Goal 数、观测次数、原始提议与解析后的 Skill，
同时明确标注该 cluster 只有慢环优先级证据权，不会生成、安装、激活或发布任何东西。

## 确定性规则

1. 只使用 `CapabilityGapStore` 中 status 为 confirmed 且带原生 Goal id/revision/objective 的 durable Gap。
2. Workspace 是硬隔离边界；相同名称在不同 Workspace 绝不合并。
3. 相同 proposed Skill name 可形成重复需求，但至少要有两个不同 Goal id。同一 Goal 的多 Session/revision
   retry 只增加观测次数，不增加独立 Goal 数，也不能独自成立 cluster。
4. 对每个 Gap，只接受零个或一个唯一 quarantined candidate package identity。identity 同时绑定 Skill name、
   source id/kind、来源版本 identity（Git commit，或 Agent Skills index/artifact digest）、tree hash 与 content hash；只有完整元组相同才去重。出现多个不同 identity 时，
   该 Gap 作为冲突证据被排除，不靠名称或排序猜一个。
5. 不同 proposed name 只有解析到同一完整 package identity 时才合并；同名但不同来源/版本/内容不会冒充
   同一解析结果，未解析的不同名字也不会做模糊聚类。
6. requested-demand cluster id 绑定算法版本、Workspace 和 exact proposed name；resolved cluster id 绑定算法
   版本、Workspace 与完整 package identity。新增同一 basis 的证据不会无故换身份；成员、名称和时间排序
   固定，Web 投影最多显示 20 个原始名称和 20 个 cluster。
7. 输出固定为 `status: evidence-only` 与 `releaseAuthority: none`。它不进入 proposer、Jobs、Candidate
   Publisher、自动晋升或任何外部动作。

## 可复核实现

- 纯 Host 派生器：`packages/dsh-evolve/src/capability-gap-cluster.ts`
- 权威控制面投影：`packages/dsh-evolve/src/evolution-control-plane.ts`
- 浏览器安全类型：`packages/dsh-evolve/src/control-types.ts`
- DSH Web 视图：`packages/dsh-evolve-web/src/client/EvolutionAction.tsx`

`capability-gap-cluster.test.ts` 覆盖：

- 三次观测、两个不同 Goal 的同名需求形成一个 cluster；
- 不同 proposed name 共同解析到一个 quarantined identity 后收敛；
- 同一 Goal 的 retry 不成立；
- 一个 Gap 出现冲突候选时 fail closed；
- 相同 Skill name 但 package identity 不同的跨名 Gap 不合并；
- Workspace 不串线，较强需求稳定排在前面。

`evolution-control-plane.test.ts` 证明 durable Gap 与隔离 Candidate 经同一权威 overview 形成 bounded cluster
投影；`evolution-action.client.test.tsx` 证明 Web 显示次数、证据类型、映射和无权限状态。

真实 in-app Browser 对实际 `EvolutionAction` 浏览器 fixture 完成验收：`2 distinct Goals · 3 Gap
observations`、两个不同提议到 `release-native-extension` 的映射及 evidence-only 限制均可见；页面没有
Install/Activate 按钮，console warning/error 为 0，限制文本具有可见布局矩形。该 fixture 证明实际 React
组件和浏览器渲染；完整 DSH Host/Client Module 安装挂载仍由 P0C-6 既有 clean-profile 证据覆盖。

## 尚未证明

- cluster 本身不会主动搜索任何外部来源；当前 [V4-8](v4-8-internal-skill-opportunity-discovery.zh.md) 只从 DSH 内部证据形成 Opportunity，后续 Candidate 也不得进行运行时外部搜索或获取。
- V4-3 本身当时未启动 Skill 生成/组合；当前生成路径另由 evidence seal、日预算、Candidate quarantine 和独立治理约束。
- 不同未解析 Gap name 之间不做 embedding/LLM 模糊聚类；这会主动漏合并，目的是避免错误需求污染。
- 没有真实模型误缺口率、跨任务 transfer、negative transfer、遗忘或长期 retention 数据。
- 没有同任务、同模型、同权限、同预算的完整 Hermes paired outcome。

因此 V4-3 只建立了双速闭环中“跨 Goal 需求证据”的第一段，不能声称慢环或自我进化已经完成。
