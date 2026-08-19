# P1.16 Automatic Evaluator Draft 契约

> 当前状态：**已撤销**。Automatic Evaluator Draft 已删除；本页仅保留历史记录，当前边界见 [ADR-0068](../adr/0068-shadow-consumes-one-exact-internal-candidate.md)。

> 状态：implemented；真实 provider、陌生用户效果与多日证据尚未完成

## 用户结果

> 对尚无可信 Case Pack 的新失败，部署者可预先授权一个静态 Skill Target；用户给出明确纠正后，常驻 Agent 自动生成私有、不可执行的 Evaluator Draft，原会话继续，人工只在独立审批区检查和资格验证。

这是 P1.9 `author` 的可选入口，不是新的 evaluator 或工作流引擎。

## 最小配置

```yaml
evaluatorTargets:
  - id: plugin-delivery
    skill: build-dsh-plugin
    root: /private/evoforge/plugin-delivery-evaluators
    dshRevision: 47f943859bef60e4160492346772ded9b24f765a
automaticEvaluatorTargets:
  - target: plugin-delivery
    maxAttemptsPerUtcDay: 1
```

`maxAttemptsPerUtcDay` 默认 `1`、范围 `1..20`。启用配置表示部署者授权把 P1.4 已界定的 direct user text、correction 与 exact single-file Skill 发送给 evaluator author provider，并承担该 Target 当日上限内的调用费用。每次输出仍由 host 固定为最多 1,600 token。

## 唯一流程

```text
still-current explicit negative feedback
  └─ pinned Generation exactly matches one static Target? ──> no: manual
  └─ same Skill already has Automatic Feedback Shadow? ──> yes: config rejected
  └─ durable daily reservation available? ──> no: defer/manual
  └─ existing EvaluatorDraftInbox.author(signal, target)
       └─ private inactive Draft ──> asynchronous human review/qualification
```

- 每轮最多发起一个 author Job；同一 Signal 的 reservation 与 author launch identity 均幂等；
- `authoring-pending` 或 transport ambiguity 后绝不自动重复 provider 请求；
- 自动结果没有执行权限。Approve/Reject、sealed qualification、Qualified Shadow、Promotion 和 rollback 沿用原接口；
- Commands/Web 只显示 bounded Target、预算和 Draft 状态，不返回 feedback 正文、路径、provider、secret 或 model prompt；
- 普通 Session 不新增 Prompt、Tool、Skill、event 或动态状态，token 增量为 `0`，当前 Session composition 不变；
- disable/remove 后只停止新自动 author，既有私有 Draft 可由原有 P1.9 控制面处理或手工删除。

## Fail closed 与非目标

多 Target 匹配、信号失效、Generation/Skill 不匹配、预算 journal 损坏、Jobs/Feedback Draft seam 不可用均只记录 bounded warning 并留给人工；不能阻塞或修改原 Session。

自动执行生成 evaluator、自动 qualification/approve、自动启动 Shadow、自动晋升、模型 judge、跨 Skill 选择、动态 Target、通用费用平台、通知中心、长期 Prompt/Memory、Mission 和多机队列均不进入 P1.16。

实现证据见 [P1.16 验证记录](../evidence/p1-16-automatic-evaluator-draft.zh.md)。
