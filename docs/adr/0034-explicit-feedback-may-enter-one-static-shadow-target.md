# ADR-0034：明确纠错可由部署策略进入一个静态 Shadow Target

## 状态

Accepted，2026-08-17。

## 背景

P1.3–P1.8 已能把一条明确负反馈安全地变成私有 Draft，并由既有可信 Case Pack 独立评测；P1.11–P1.13
已能在证据明确时执行 Retention 并只晋升 future Session。但常驻使用仍有一个重复机械断点：每条已知
失败类型都要人工再次执行 `/evolve feedback <id> shadow <target>`。这不是语义判断，只是在已由部署者
固定的 Skill、Case Pack、run root 与成本边界之间接线。

直接后台反思、自动生成 evaluator、动态挑选 Target 或默认外发反馈都会扩大隐私、费用与误晋升风险；
新队列、daemon、workflow 或 Mission 又会重复 DSH 已有 Jobs、Goal 和插件生命周期。

## 决策

增加可选 `automaticFeedbackTargets`。每项只引用一个既有 `shadowTargets.id` 并固定该 Case Pack 的
exact content hash。配置同时表达两项部署授权：允许为符合条件的一条明确纠错创建最小私有 Draft，
并允许启动一次该 Target 已声明预算内的 proposer/evaluator 工作。

既有 Shadow Supervisor 每轮最多处理一条当前 Explicit Feedback Signal。只有信号固定在 exact
Generation，且该 Generation 只匹配一个已授权 Skill Target 时才启动；零匹配保持手工路径，多匹配
视为歧义并进入异步人工选择。Candidate、Trial、Review、Retention、Promotion 与 Rollback 全部复用
已有实现，不建立第二套状态。

普通 Session 永不等待。当前 Session 继续固定原 Generation；只有 P1.1 clear-win、P1.12 exact
Retention 和所有既有门均通过时，future Session 才切到新 Generation。

## 费用、崩溃与不确定性

- 每轮最多一个新 launch；默认不配置即零后台 proposer 成本；
- output/launch id 继续由 signal、Draft、Target、Case Pack、模型 identity 与 Skill tree 内容寻址；
- 若付费请求已进入 `proposal-pending` 而结果未落盘，自动路径绝不重发；人工路径也不会被自动批准；
- durable Candidate/Trial 可以沿既有 journal 恢复，terminal run 只复用事实；
- Retention 固定零 proposer，assembled evaluator 的独立模型费用仍由其 Target 策略与报告负责；
- 模糊、失配、篡改、执行失败、回归或不完整结果都不阻塞原会话，也不自动晋升。

## KV Cache 与边界

- 不新增 Tool、Skill、Prompt、system message、Session event 或动态 catalog；
- `automaticFeedbackTargets`、signal、Draft、paths、reports 与后台状态都留在 host plane；
- enabled/disabled 的完整正常模型请求必须逐字段相等；
- 不自动 author 或 qualify evaluator，不让 proposer 自评，不处理无明确 correction 的隐式行为；
- 不新增通用 Signal/Memory/Case Registry、预算调度器、通知中心、Mission 或跨主机队列。

## 拒绝方案

- **每条负反馈都后台反思**：没有静态 evaluator 与费用授权，且会制造噪声候选；
- **让模型选择 Target**：增加模型成本，也不能解决隐私或付费授权；
- **自动生成并信任 evaluator**：提案者兼任裁判，P1.9 的人工语义资格验证仍必须独立；
- **复用逐次确认弹窗**：常驻自主仍停在相同机械步骤，且原会话会等待；
- **新增 durable queue/daemon**：现有 Signal Store、run journal、Supervisor 与 native Jobs 已覆盖事实与恢复。
