# ADR-0030：Qualified Case Pack 只能通过新的显式动作进入既有 Shadow

- 状态：accepted
- 日期：2026-08-17

## 背景

P1.9 可以把明确纠正变成私有 Evaluator Draft，并在独立人工审查后发布 Qualified Case Pack。但该
Pack 的 host path 不跨 Remote，用户若要继续，只能手工寻找私有目录、复制路径并新增静态
`shadowTargets`。这使安全的中间结果成为产品死端，也诱使用户绕过 exact hash 与原始 Feedback
归因。

问题不是缺少新工作流引擎，而是 P1.9 与 P1.8 之间缺一条受限接线。

## 决策

1. Evaluator Target 可选声明一个独占 `shadowRunRoot`；它必须是现有
   `supervisor.runRoots` 的 exact absolute path。未声明时 P1.9 行为不变，Qualified Pack 只能审查。
2. 新动作 `/evolve evaluator <exact-draft-id> shadow` 只接受已 `qualified` 的 exact Pack。Web 显示
   独立的付费与私有纠正外发确认；原 Session 不等待。
3. host 从 P1.9 journal 恢复 original signal、exact Skill、qualified directory 与 pack hash；Remote、
   Command 和浏览器不能提交或读取 path、Case Pack、模型或预算。
4. 该动作调用 P1.8 的同一个 `FeedbackShadowLauncher`。只增加一个 exact-path launch seam 和动态
   run-root 观察，不复制 proposer、Candidate、Trial、resume 或 review 状态机。
5. launch 前再次验证 Draft 与 Qualified Pack hash；P1.8 继续重新创建/验证 current Feedback Case
   Draft、exact Git Skill、model route、Case Pack hash 与 durable launch identity。
6. 相同 qualified draft 与 model route 产生相同 Shadow launch；活动或终态 journal 复用，付费
   `proposal-pending` 的崩溃语义保持不自动重试。
7. Qualified 只说明 evaluator 方向成立。Shadow 仍先校准，再请求一个 Candidate，走 paired Trial、
   review/最窄 auto-policy、future-session pin 与 rollback；本动作不能直接晋升。

## KV Cache 契约

新配置、按钮、journal linkage 与 run scan 全在 host/control plane。它不注册 Tool、Prompt、Skill、
System Message 或 Session Event。未触发时与普通 Session 的完整 model request 必须逐字段相等；动作
只产生 P1.8 已披露的一次独立 proposer 请求。

## 拒绝的方案

- **Qualification 成功后自动启动 Shadow**：新增付费和私有数据外发必须另行授权。
- **把 qualified path 返回给 Web/Command**：泄露 host topology，并让浏览器成为 authority。
- **复制一套 QualifiedShadow 状态机**：P1.8 已拥有 Jobs、run journal、resume、scan 和幂等语义。
- **把 run root 默认为 Evaluator private root**：隐藏的目录约定会绕开 supervisor recovery 配置。
- **Qualification 直接创建 Candidate/Generation**：方向校准不是改进证据。
