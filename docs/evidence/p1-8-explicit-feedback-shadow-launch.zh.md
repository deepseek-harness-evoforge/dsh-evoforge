# P1.8 证据：显式、目标绑定的 Feedback Shadow Launch

> 声明等级：`implemented`；闭合现有反馈到后台 Shadow 的可用性断点，不声明自动生成 evaluator、真实任务改善率或生产可靠性。

## 用户结果

过去用户已经能收集明确负反馈、生成私有 Case Draft、运行反馈引导 Shadow 和复核 Candidate，
但仍要手工拼接 Skill、Case Pack、Draft 与 output 路径。P1.8 让操作者一次配置公开 Target，之后
用户只选择一个仍有效的 signal id 和 target id：

```text
/evolve feedback <signal-id> shadow <target-id>
```

Web 提供同一动作，并在调用前明确提示可能产生一次付费 proposer 请求，以及受限私有纠正将发送
给已配置 provider。调用提交原生 `evolution` Job 后立即返回，产生反馈的 Session 不等待。

## 最小设计

- Target 静态绑定 exact Skill、已校准 Case Pack 和现有 supervisor run root；浏览器不能传路径。
- host 在启动时重做 P1.4 的 current feedback、Session pin、单 Skill invocation 与 exact Git 校验。
- launch id 由 signal、内容寻址 Draft、Target、Case Pack hash、Skill tree 和模型 route 派生。
- 同一进程重复点击只提交一个 Job；已有终态 journal 的重复调用直接返回现有状态，不重复付费。
- run-local Shadow journal 仍是重启事实源；Jobs 只负责当前进程观察、取消与状态展示。
- overview 只投影最多 20 个 signal、20 个静态 target 和 20 个近期 run；不返回 feedback 文本、
  Session/message id、host path、Prompt、模型地址或凭据。
- 不新增 Tool、Prompt、Skill、System Message 或 Session Event；正常 DSH Session token 增量为 0。

## 自动化证据

- launcher 单元测试覆盖目标/root 边界、私有 Draft 与 exact Git seam、一次 Job、并发重复去重、
  终态 durable evidence 复用和缺少运行 seam 时 fail closed；
- Control Plane、生成式 Remote、Commands 与 React UI 测试覆盖 bounded projection、wire 参数，
  以及 Web 在确认前不得调用、确认后只发送 exact signal/target id；
- pinned DSH `47f943859bef60e4160492346772ded9b24f765a` 的真实 Loader/Storage/Message Feedback/
  Session Persistence/Jobs composition 证明该入口可用并且能投影同一 signal 与 target；
- workspace 验证为 163 passed、3 skipped；三包 typecheck/build、Typert source digest、9 个
  Remote 方法、peer 完整性与 `git diff --check` 同时通过。

## 尚未证明

- 尚未用真实 provider 测量用户纠正带来的 Candidate 改善率和每次改善 token 成本；
- 新 UI 动作仍需在 packed、固定 DSH 的真实浏览器中复验；
- 自动 evaluator 仍不存在：Target 必须指向覆盖该失败类型并通过 calibration 的 Case Pack；
- 短时测试不等于生产多日常驻、磁盘耗尽或任意崩溃时序证据；
- 完成的 Candidate 仍进入既有 review/auto-policy，Launch 本身不授权晋升。

设计取舍见 [ADR-0026](../adr/0026-feedback-shadow-launch-is-explicit-and-target-bound.md)。
