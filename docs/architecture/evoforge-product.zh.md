# EvoForge 产品架构

> 状态：产品边界已确认；首仓与首个插件名已冻结
> 更新日期：2026-08-15

## 1. 产品结果

EvoForge 不是第四套 Agent Runtime。它让 DSH 在选定真实工作流中成为比 Hermes 更可靠、更可控、更节省缓存并能用证据持续进化的长期 Agent。

```text
人类交互面
  └─ status / timeline / evidence / approve / pause / rollback
                         │
DSH Runtime ─ Goal / Session / Tool / Approval / Storage / Jobs / Skill
                         │
EvoForge 可选能力
  ├─ Evolve：从真实结果产生、评测和发布能力候选
  ├─ Software Delivery：隔离、验证、commit、Draft PR
  └─ 后续 Assistant Adapter：消息、日程、内容或个人工作流
```

DSH 始终拥有模型执行和基础服务；EvoForge 插件只增加用户结果。插件卸载后，原生 DSH Session 和 Goal 仍可恢复。

## 2. 首批能力边界

### dsh-evolve

旗舰插件。P0A 只提供离线 Shadow；证明 evaluator 有价值后，才增加 Generation、Session pin、晋升、监测和回滚。Observer、Trial Runner、Decision 和 Release 都是内部模块，不拆成浅插件。

### dsh-software-delivery

独立插件。它把一个原生 Goal 交付为隔离 worktree、仓库检查、可审查 diff、commit 和可选 Draft PR。即使不启用 Evolve，它仍有完整用户价值；启用后，它提供第一组强 outcome signal。

### Assistant Adapter

不是首版承诺。只有一个高频具体工作流、明确外部效果边界和可验证 outcome 同时成立时，才增加一个消息、日程、内容或个人助理 Adapter。每个 Adapter 独立安装，不复制 Hermes 巨型 Gateway。

当前不创建独立的 Mission、Supervisor、Cache、Policy、Memory、Event Store 或通用 UI 平台插件。两个真实消费者出现前，共享接缝留在插件内部。

## 3. 交互契约

交互是产品能力，不是模型 Prompt。

所有界面 Adapter 投影同一组权威状态：

- Goal、阶段、进度、阻塞原因和下一步；
- Candidate claim、diff、case、baseline/candidate 结果；
- token、latency、完整 composition cache 指标；
- 当前权限、请求的权限变化和 Protected Action；
- active Generation、parent、canary、rollback target；
- approve、reject、pause、resume、promote、rollback 动作结果。

第一版使用 DSH command/host view 即可。只有至少两个界面 Adapter 需要同一稳定投影时，才抽出公共 Control API。UI 刷新不得新增每轮模型调用、动态 system prompt 或会话内工具变化。

## 4. 可靠性层级

| 层级 | 承诺 | 不承诺 |
|---|---|---|
| P0A Offline Safety | Shadow 不修改 active Skill；评测可重放 | 常驻、晋升、高可用 |
| P0B Local Continuity | 单机重启后恢复 pipeline；无半激活 Generation；幂等外部请求 | 多机故障转移 |
| P1 Bounded Autonomy | future-session canary、窄自动晋升、反事实回滚 | 代码或外部动作自治发布 |
| Future High Availability | 明确 SLO、多个故障域、选主和故障转移 | 在需求与运行数据出现前预建 |

已经发生的消息、日程、付费、部署和数据修改不能通过能力版本回滚撤销，必须继续使用 DSH Protected Action 或领域补偿流程。

## 5. KV Cache 不变量

1. 同一 Session 固定 Capability Generation。
2. 默认不增加常驻 Evolve system prompt 或模型工具。
3. 工具名、Schema、顺序和 Skill catalog 在 Session 内稳定。
4. 动态状态、审批、时间线和 UI 投影位于 host plane。
5. Skill body 只在原生 Skill 加载路径按需进入后缀。
6. Candidate 只改变被测 artifact；其余完整 composition 必须一致。
7. 晋升只影响未来 Session，并记录 composition fingerprint。
8. 缓存退化是 hard gate；收益不能只用插件局部 token 自证。

## 6. Hermes Replacement Target

“上位”必须按同一任务集验证：

| 能力 | EvoForge 目标 | 当前证据 |
|---|---|---|
| 软件交付 | 原生 Goal 到 verified commit/Draft PR | 已设计，未实现 |
| 单机持续运行 | crash-resume、幂等恢复、无半激活版本 | Generation release 边界已实现并通过 `SIGKILL`；完整 pipeline pending |
| Memory/Skill | 复用 DSH/社区能力，不造第二套 Memory | 架构边界已确认 |
| 消息与日程 | 按真实 workflow 提供可拆 Adapter | 后续验证，不承诺首版 |
| 人类控制 | 状态、证据、审批、暂停、回滚不阻塞会话 | 契约已定义，未实现 |
| 自进化 | 独立 final-test、inactive Candidate、可证明晋升 | P0A 本地未见 `fail → pass` + P0B.1 verified-Git Generation/Session pin/rollback；控制面与自动政策 pending |
| 权限 | 代码和外部效果不自动激活 | 需求与测试门已定义 |
| KV Cache | Session 内完整 composition 稳定 | 真实两轮 Agent 前缀与 Tool surface 回归通过；长会话 cache token soak pending |
| 回滚 | future Session 精确恢复 artifact；外部效果不虚假承诺 | exact parent Git tree 与 live Session 不漂移已实现；外部效果仍不在回滚范围 |

只有这些项目在真实任务、故障注入和成本测量中成立，才可以宣称对应范围优于 Hermes。

具体 paired benchmark、hard gate 和声明等级见 [Hermes 上位目标验收记分卡](hermes-replacement-scorecard.zh.md)。单个能力胜出只能声明对应工作流；在消息或日程等 Hermes 优势范围尚未交付前，不作全局“已经上位”声明。

## 7. 仓库策略

GitHub 组织 `deepseek-harness-evoforge` 是所有 DSH 扩展设计与开发的公开归属。默认在 EvoForge Suite 中共仓，避免每个内部阶段一个空仓库。

出现以下任一条件时允许拆仓：

- 独立版本与发布节奏；
- 独立权限、秘密或供应链信任边界；
- 明显不同的运行时、重型依赖或许可证；
- 用户可以不安装 Suite 其余部分而完整采用；
- 独立维护者需要清晰所有权。

首个公开仓库为 `deepseek-harness-evoforge/dsh-evoforge`，首个插件包为 `dsh-evolve`。相关插件默认留在该 Suite；只有 ADR 0005 的拆仓条件成立时才创建新的 `dsh-*` 仓库。

## 8. 最小路线

1. **P0A**：`dsh-evolve shadow <skill-dir>`，一个真实 Skill、独立 final-test、已知坏 Candidate 和至少一个真实修正。
2. **P0B**：Generation、Session pin、原子 active pointer、crash recovery、composition fingerprint。
3. **P0C**：host command/view、异步人工晋升和 rollback。
4. **P1**：权限效果不变的纯指令 future-session canary 与窄自动晋升。
5. **P2**：Software Delivery 正式产品化；代码 Candidate 只到 Draft PR。
6. **P3**：基于真实用户 workflow 选择一个 Assistant Adapter。

每一阶段未达到可验证退出条件时停止扩张，不用更多插件或基础设施掩盖失败。
