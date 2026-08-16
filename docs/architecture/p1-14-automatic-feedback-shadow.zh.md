# P1.14 Automatic Feedback Shadow 契约

> 状态：implemented；默认关闭，只自动消除“已知失败 + 已有可信 evaluator”路径中的机械启动步骤

## 唯一用户结果

> 用户在正常 DSH 会话中对一次明确调用过的 Skill 给出“负反馈 + 非空纠正”后，若部署者已为该
> Skill 授权唯一静态 exact Shadow Target，原会话立即继续；后台自动产生独立证据，并在 clear-win
> 与 Retention 都通过时只升级未来会话。

这不是默认后台反思。没有可信 Case Pack、Target 歧义、代码/权限效果、评测不确定或回归时，工作留在
既有异步人工区，正常 DSH 对话不等待。

## 最小配置

```yaml
feedbackDraftRoot: /absolute/private/evoforge/feedback-drafts
supervisor:
  runRoots:
    - /absolute/private/evoforge/feedback-shadow-runs
  scanIntervalMs: 30000
shadowTargets:
  - id: plugin-delivery-feedback
    skill: build-dsh-plugin
    casePackDir: /absolute/path/to/calibrated-case-pack
    runRoot: /absolute/private/evoforge/feedback-shadow-runs
automaticFeedbackTargets:
  - target: plugin-delivery-feedback
    casePackHash: <64-char-content-hash>
```

`automaticFeedbackTargets` 只引用既有 Target，不接受动态 path、Skill、模型或单次 Case Pack 预算参数。Target ≤ 20；
引用必须存在；Case Pack hash 必须 exact；每个自动 Target 的 Skill 必须唯一。配置是部署者对最小私有
copy 和该 Target 一次 proposer/evaluator 成本的明确策略授权。删除该段即恢复 P1.8 逐次显式启动。
P1.15 后每项另有可选 `maxAttemptsPerUtcDay`，只收紧跨 Signal 自动尝试次数，不改变 Case Pack 单次
token budget；默认 `1`。

若希望明显正向结果自动进入未来会话，再独立配置 P1.1 `autoPromote`、P1.12 `retentionRoots` 与 P1.13
`retentionTargets`。P1.14 本身不放宽任何 Promotion policy，也不把人工 promote 变成 hard block。

## 精确触发条件

```text
native message feedback
  └─ current negative + non-blank correction? ──> no: no Signal
  └─ Session pinned to exact EvoForge Generation? ──> no: manual/no-op
  └─ Generation matches exactly one authorized Target? ──> no/multiple: manual review
  └─ native Jobs + private Session Persistence available? ──> no: wait without blocking Session
  └─ exact Case Pack hash + exact Git Skill still valid? ──> no: fail closed
  └─ one content-addressed Feedback-guided Shadow Job
       └─ calibrated baseline fail / Candidate pass? ──> no: review/reject
       └─ P1.1 clear instruction + P1.13 prior retention? ──> yes: future Generation
```

Supervisor 每轮最多启动一个 feedback Target。Signal Store 只保留引用；真正启动时仍由 P1.4 重新读取
native feedback、Session Persistence、exact Skill invocation 与 Git tree，并创建 `0600` 私有 Draft。
P1.5 只把用户文本和纠正交给 proposer；Case Pack evaluator 从未接收该 Draft 作为正确答案。

## 崩溃、幂等与回滚

- launch identity 继续包含 signal、Draft、Target、Case Pack、model identity 与 Skill tree；
- complete/incomplete 输出直接复用；durable Candidate/Trial 由既有 journal 恢复；
- `proposal-pending` 表示请求可能已经付费，自动扫描只返回该状态，永不再次请求；
- 原 Session 永远保留旧 Generation；晋升只改变 future Session pointer；
- 每个 Generation 可用既有 `/evolve rollback` 恢复 future Session；外部已发生效果不伪装成可回滚。

## KV Cache、隐私和成本

- normal Session 完整 model request 在启用前后逐字段相等，额外 token 为 `0`；
- 没有 polling Tool、动态 Prompt、Signal 注入或 per-turn Skill catalog 变化；
- 每个新 feedback launch 最多一个 proposer 请求，预算沿用 exact Case Pack；完整 paired path 为四次
  evaluator execution；后续 Retention 为零 proposer、四次 evaluator execution；
- Draft 最大复制 8 KiB direct user text + 4 KiB correction，并且不含 assistant response、Tool output、
  Skill body、cwd 或完整 transcript；proposer 输出若回显内容，仍会成为 durable Candidate evidence；
- assembled evaluator 若调用模型，其 usage 单独报告，不能与普通 Session 或 proposer token 混算。

## 非目标

自动 evaluator authoring/qualification、默认后台 reflection、无反馈行为推断、多 Target quorum、Case
Registry、Memory graph、通用预算调度、通知中心、Web 配置编辑、跨主机执行、Linux/Windows sealed
backend 与生产多日 soak 均不进入 P1.14。
