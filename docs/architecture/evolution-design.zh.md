# 会话优先的自我进化设计

更新时间：2026-09-05。本文替代旧的“Goal → Gap → Candidate”单一入口叙述。Goal 仍是 DSH 的原生长任务对象，
但不是所有交互的前提；进化观察的是原生 DSH Interaction 和结果。

## 1. 设计目标

让 DSH 在不改变当前会话、不引入第二运行时的前提下，能从真实工作中可靠地改进可复用 Skill。改进必须：

- 有可追溯的事实来源，而不是模型自评；
- 能区分一次失败、用户偏好、配置问题和真正能力缺口；
- 在隔离 Candidate 上验证，不能把实验写进 live Skill；
- 通过未见样本、回归、安全、权限、成本、时延和 KV cache 门禁；
- 支持等待、隔离、崩溃恢复、原子晋升、canary 和精确回滚。

## 2. 输入模型：Interaction，不是 Goal 表单

系统接收 DSH 原生事件：

| 事件 | 例子 | 可形成的事实 |
| --- | --- | --- |
| message | 普通聊天、问题、指令、附件 | 请求、上下文、使用的能力 |
| command | 原生命令、schedule dispatch | 明确动作与权限边界 |
| feedback | 用户纠正、评分、重做要求 | 显式负/正反馈 |
| tool/session event | Tool 结果、Session flush、终态 | 成功/失败、组成、版本 |
| external outcome | PR、消息、API 返回 | 外部效果或 uncertain |
| native Goal event | 创建、继续、完成、暂停 | 可选的长任务关联 |

每个事件可以带材料、约束、验收标准和所需权限；权限仍由 DSH policy/Approval 决定。没有 Goal 的普通消息照常
执行，也照常产生可归因信号。Goal id 只是可选关联字段，缺失不应阻断记录。

系统内部使用 work episode 作为只读投影，把相邻事件、当前 Session、Workspace、Generation 和外部结果关联起来。
它不是新的 Session、Goal、任务库或调度器，不能成为第二权威。

## 3. 原生执行与缺口诊断

一次交互仍由 DSH Agent 按原生机制执行。EvoForge 不在前面插入分类器、路线规划器、能力选择器或市场搜索，也不替
Agent 决定应该调用什么。它在执行后读取实际发生的 Skill/Tool 调用、版本、权限、Session pin 与结果，用这些事实做
诊断。

缺口诊断按顺序排除：

1. 当前能力是否适用；
2. 配置、凭据、权限或外部服务是否阻断；
3. DSH Core 是否违反其文档契约；
4. 是否存在可复现、可迁移的能力缺口。

只有第 4 项才创建 Gap investigation。一次失败、一次 retry、模糊模型回答或用户偏好都不能直接生成 Candidate。

## 4. 在线快环

快环在原生 Session 完成一个可观察步骤后运行，目标是低延迟记录事实，不做发布决策。

~~~text
事件 → 归因 → 脱敏快照 → signal/Gap/Outcome → 继续当前 Session
~~~

快环记录：

- 事件与 Session/Workspace/Generation 身份；
- 实际 Skill/Tool content hash 和模型可见组成；
- 失败类别、用户纠正、验证结果和观察到的额外工作；
- provider token、耗时、cache-read 等已测指标；货币成本没有数据时标记 unavailable；
- 外部效果的 delivered、failed 或 uncertain；
- 关联的 native Goal id（可为空）。

快环永远不改 active Skill、不选择 Candidate、不调用评测模型、不触发外部写入。持久化失败必须可见，不能静默丢失。

## 5. 离线慢环

慢环只消费已封存的 signal 和 DSH 权威读取结果，在后台 Job 中运行：

1. 对同一 Workspace 的 Gap 和显式纠正做去重、聚类和边界检查；
2. 判断是缺失能力、现有 Skill 改进、配置/权限问题还是应 abstain；
3. 形成 Candidate authoring 输入；禁止把外部 URL、市场包或未验证资料当作运行时来源；
4. 由独立治理面预先切分 admission、holdout、retention 和未见样本；
5. 在隔离 run root 中做 baseline/candidate 对照和回归；
6. 记录失败归因、成本/时延/cache、权限和副作用；
7. 输出 promote、review、quarantine、reject 或 incomplete。

慢环不阻塞发起它的 Session；支付请求或真实外部执行前必须有明确授权，未知结果不得盲目重试。

## 6. Candidate 契约

Candidate 是完整 Skill 包，而不是一段可直接覆盖 live Skill 的文本。其内容寻址身份至少绑定：

- Workspace、Skill 名称、父 Generation 和完整目录树；
- 产生它的 Interaction/signal 摘要、来源类型和时间边界；
- DSH revision、模型/预算、权限与工具组成；
- evaluator、case pack、holdout/retention 的 hash；
- author、proposer、治理者的角色与谱系；
- 允许修改的文件范围、许可证和安全扫描结果。

Candidate 存在于 inactive/quarantine 区，执行面只读消费指定版本。Candidate 不能读取隐藏 case、改 evaluator、
写入 profile、安装自己或改变当前 Session。

### 6.1 Candidate 状态机

状态只由 Host/治理面推进；Candidate、模型和浏览器不能直接改状态。每次转移都写入内容寻址事件，崩溃后按最后
一个 durable 事件恢复，无法证明边界时保持 `uncertain`。

| 状态 | 进入条件 | 允许的下一步 | 失败含义与负责人 |
| --- | --- | --- | --- |
| `observed` | 已封存 Interaction signal 和 gap/investigation | `eligible`、`abstain` | 证据不足由 Host 标记 `abstain` |
| `eligible` | 通过重复性、权限和范围检查 | `authoring`、`abstain` | 诊断/聚类由慢环 Host 负责 |
| `authoring` | 只收到 authoring 分区和策略 | `quarantine`、`reject` | proposer 只能写候选包，不能评测或发布 |
| `quarantine` | 完整 tree 已生成并通过路径/大小/hash 检查 | `admitted`、`reject` | Host 保留不可执行副本；安全/完整性失败拒绝 |
| `admitted` | deterministic admission 与 calibration 通过 | `trial`、`blocked` | 治理面确认 holdout/retention 已预封存 |
| `trial` | baseline/candidate 在隔离 DSH 组合中运行 | `qualified`、`review`、`incomplete` | evaluator 负责结果；超时/崩溃/泄漏为 `incomplete` |
| `qualified` | 未见样本、回归、资源和权限门均通过 | `approved`、`review` | 人工或窄策略批准，不由 proposer 决定 |
| `approved` | Host mutation gate 验证 lineage 与 policy | `promotable`、`blocked` | 仅允许 instruction-only 低风险范围 |
| `promotable` | 原子创建 inactive Generation | `selected`、`rollback` | 只影响 future Session；当前 Session pin 不变 |
| `selected` | future-Session pointer 原子切换 | `canary`、`stable` | 失败由独立 canary/rollback gate 处理 |
| `review` / `abstain` / `blocked` / `incomplete` | 证据模糊、越权或边界不明 | 只能人工复核或重开新候选 | 不得自动重试、晋升或覆盖原记录 |

一个最小的普通对话例子：用户在原生 Session 发送“把这批接口迁移并给出可运行验证”，Agent 使用已安装 Skill，
用户随后纠正遗漏并要求返工。快环把消息、纠正、验证失败、返工耗时和工具结果关联成 signal（没有 Goal 也可）。
慢环发现同一 Skill 的独立 Interaction 重复出现同一缺口，形成 `eligible` investigation；author 只看到封存的
authoring 样本，生成整包 Candidate 后进入 quarantine。治理面预先准备未见 holdout，baseline/candidate 在相同
DSH composition 下对照；若结果冲突就停在 `review`，若所有门通过才创建 inactive Generation。之后新建的 Session
才可能选择它，原 Session 继续使用旧 pin；失败 canary 只切换未来 pointer，不能撤回已发送消息或已提交代码。

## 7. 三平面隔离

| 平面 | 可做 | 明确不可做 |
| --- | --- | --- |
| Execution | 使用当前 active Generation 完成真实交互并记录 signal | 直接写 Candidate 或治理结果 |
| Candidate | 根据允许的 authoring 输入生成完整 Skill tree | 读取 holdout/evaluator、执行外部副作用、发布 |
| Evaluation governance | 持有 case、gold、策略、比较和 release eligibility | 接受 Candidate 自评、被 proposer 修改 |

proposer 与最终裁判必须是不同角色/调用边界；治理数据在 authoring 前封存。任何边界泄漏都将该 Trial 标为
incomplete/blocked，而不是 pass。

## 8. 评测与门禁

每个 Candidate 至少经过：

1. 结构准入：目录边界、完整性、许可证、权限和内容 hash；
2. calibration：known-bad 必须 fail，known-correction 必须 pass；
3. paired admission/holdout：相同 DSH composition、模型、权限、预算，只改变被测 Skill；
4. 未见样本与 retention：验证跨交互迁移，不把训练样本当效果；
5. 回归与负迁移：旧能力不能被破坏，冲突结果保持 review；
6. 安全/Protected Action：代码、凭据和外部副作用必须拒绝或进入人工批准；
7. 资源门禁：token、延迟、cache-read 和 provider 限额不能无证据恶化。

缺少独立样本、组成漂移、超时、崩溃、未知支付结果或结果矛盾时输出 abstain/quarantine/uncertain。

## 9. 晋升、Session pin 与回滚

晋升是 Host 的原子 mutation，不是 Candidate 或 Web 自己写指针。明确胜出的低风险 instruction-only Candidate 可按
Workspace policy 自动晋升；模糊或高风险 Candidate 必须人工 approve。晋升后：

- 新 Generation 只对之后创建的 Session 可见；
- 已运行 Session 继续使用原 pin；
- 选择历史、谱系和证据一起持久化；
- 失败 Outcome 触发反事实 canary，而不是立即回滚；
- rollback 先重新验证 exact lineage、预期 active pointer 和 canary，再由受权限动作切换未来 Session；
- 崩溃恢复从 durable journal 继续，未知阶段保持 uncertain；
- 已发送消息、已合并代码或已付款的外部效果不会被宣称撤销。

## 10. 用户可见控制面

Evolution 页面只投影 Host 权威数据：

- Interaction/episode 时间线和 signal 类型；
- capability map、gap queue、Candidate 来源/版本/谱系/diff；
- baseline、admission、holdout、retention、失败归因；
- token/延迟/cache、权限和 Protected Action；
- promote、review、quarantine、pause、resume、rollback 的决定与审计。

页面不显示隐藏 case、完整私密材料、凭据、模型私有 prompt 或 Host 路径。刷新失败保留最后一个 good snapshot，并标记
stale/error；恢复后再替换。没有 active native Session 时，DSH 的 conversation.view 可能不可见，不能用第二网页绕过。

## 11. 与 Hermes 的差异

Hermes 的普通对话、渐进式 Skill、异步 review、Curator、Gateway 和跨平台 Session 是本设计的参考。EvoForge 进一步
把“是否值得长期保留”变成独立证据问题：不以调用次数或一次成功晋升，不允许 proposer 看到 holdout，保留
Session pin、retention、cache/成本和可回滚记录。目标是对声明的工作流给出可复核的 better，而不是声称 Hermes
所有模块都被复制。
