# ADR-0095：Generation 选择历史与活动指针原子持久化

状态：accepted

## 决策

每次真正改变 Workspace 活动 Generation 的晋升或回滚，都必须在现有 `workspace_states` Storage Domain 的同一次写入中，同时更新活动指针并追加一条不可变 `GenerationSelectionEvent`。事件记录单调 sequence、变更前后 Generation、动作类型、时间和唯一授权依据：内部 Retention、existing-Skill Release、显式人工、missing-Skill Canary 或 existing-Skill Canary。事件 id 对完整内容寻址；重复选择已经活动的 Generation 不产生事件；最多保留最近 100 条，但 revision 继续单调前进。

该历史不建立第二个数据库、事件总线、Session、Goal、Runtime 或审批体系。现有 Store 仍是唯一 pointer owner，晋升与两类回滚 Host gate 只把其已重验的 evidence id 交给 Store。当前 Session 的既有 pin 不随 pointer mutation 改变；冷启动从同一 Workspace state 恢复指针、历史和 Session pin。

Host Control 只向浏览器投影有界的最近 20 条、总晋升/回滚数及 Canary/显式回滚分类。DSH Web 明示它只证明“哪个 authority 在何时改变了 future-Session selection”，不证明 Candidate 改善、失败因果、误晋升或误回滚，也不授予发布权。长期效果必须另由 Outcome、paired benchmark 和真实 Provider 门禁证明。

## 理由

活动指针如果只有当前值，用户无法在冷重启后回答“这次选择由哪个门禁产生、回滚针对哪个版本”。把日志放进独立 Store 会产生 pointer 已写而 audit 未写、或相反的双写窗口。与 pointer 同域同写能让崩溃恢复读到一个一致事实，同时保持评测者无 mutation authority、Web 无直接 writer 和 DSH 唯一 Runtime 边界。

## 拒绝的方案

- 用 Git branch/tag 记录运行时 Candidate 或每次 pointer mutation；
- 由 Web、Command 或 evaluator 自行写审计日志；
- 从 Canary、Review 或当前 active pointer 事后猜测历史；
- 把选择历史称为效果时间线、成功率或长期进化证明；
- 为此增加第二数据库、通用 Event Sourcing 平台或新的 Agent Runtime。
