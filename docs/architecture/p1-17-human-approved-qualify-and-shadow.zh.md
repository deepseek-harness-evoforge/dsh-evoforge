# P1.17 Human-approved Qualify-and-Shadow 契约

> 状态：implemented；真实用户可用性和 provider outcome 尚未完成

## 用户结果

> 人工读完一个 exact Evaluator Draft 后，可用一次明确确认批准 sealed qualification，并预授权“仅在 qualification 成功时”启动一次付费 Shadow；失败不调用 proposer，原会话不等待。

这是 P1.9 `approve()` 与 P1.10 `startShadow()` 的组合入口，不是自动 qualification、事务引擎或新工作流。

## 两个等价入口

```text
/evolve evaluator <64-char-draft-id> qualify-shadow <human-note>
```

Web 的 Draft detail 同时保留 `Qualify Evaluator` 和 `Qualify & start Shadow`。后者必须显示一个联合确认，明确说明：

- generated evaluator 只在 sealed runner 中执行；
- qualification 失败时不会调用 proposer；
- 成功后会把 P1.4 已界定的受限用户文本和纠正发送给配置模型，并可能付费；
- 不修改 Skill、不激活 Generation，也不授权 Promotion。

## 唯一执行顺序

```text
human reviewed exact Draft + note + paid disclosure
  └─ EvaluatorDraftInbox.approve(exact id, note)
       ├─ not calibrated / incomplete ──> stop; proposer requests = 0
       └─ qualified (durable, immutable)
            └─ EvaluatorDraftInbox.startShadow(exact id)
                 └─ existing P1.10 content-addressed launch/journal
```

- receipt 仍为既有 `start-shadow`，没有第二套状态或 Decision；
- `qualified` 的重复 approve 是幂等读；qualification 后、launcher 回执前中断时可安全重试；
- Draft/Qualified Pack hash 漂移、缺少 static `shadowRunRoot`、Jobs 不可用或 launcher 不确定均 fail closed；
- 原有分步 qualification 和 Qualified Shadow 保留，便于需要先观察 calibration 结果的用户；
- Commands、Remote 和 Web 只传 exact draft id 与 bounded note，不返回私有路径、Prompt、secret 或 feedback 正文；
- 普通 Session 不新增 Prompt、Tool、Skill、event 或动态状态，token 增量为 `0`。

## 非目标

自动审批、默认后台 qualification、qualification 失败时自动改写 evaluator、把一次确认扩展到 Promotion、跨 Draft 批处理、通知中心、Mission、通用工作流引擎和多机事务均不进入 P1.17。

实现证据见 [P1.17 验证记录](../evidence/p1-17-human-approved-qualify-and-shadow.zh.md)，决策见 [ADR-0037](../adr/0037-one-human-action-may-qualify-and-start-shadow.md)。
