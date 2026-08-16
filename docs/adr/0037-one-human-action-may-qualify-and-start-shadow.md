# ADR-0037：一次人工动作可批准资格验证并有条件启动 Shadow

- 状态：accepted
- 日期：2026-08-17

P1.9 把模型生成的 evaluator 保持为 inactive Draft，P1.10 又要求 Qualified Case Pack 通过新的显式付费确认进入 Shadow。这两个权限边界是正确的，但在用户已经读完 exact Draft、写下决策备注并愿意承担本次 Shadow 成本时，先点 qualification、等待刷新、再点 Shadow 是一个不增加判断的机械断点。

因此 `EvaluatorDraftInbox` 增加 `approveAndStartShadow(draftId, note)`：它先执行既有 exact-hash sealed qualification，只有返回 `qualified` 后才委托既有内容寻址 Shadow launcher。Commands 使用 `/evolve evaluator <id> qualify-shadow <note>`，Web 在同一个确认框中同时披露 generated-code execution、受限纠正外发和一次潜在付费请求。用户仍可选择原有分步 `approve` 与 `shadow`。

组合动作不增加状态机或新 receipt。qualification 失败时 proposer 调用为零；若 qualification 已持久化而 Shadow 提交中断，重试会幂等读取 `qualified`，不会再次执行 evaluator qualification，并复用 P1.10 的 Shadow journal。它不授权 Promotion、merge、release、deploy、secret 读取或任何不可逆外部效果，也不会阻塞产生纠正的 Session。

拒绝自动 qualification、后台默认执行、一键 qualification + Promotion、模型替用户审批和新的 orchestration service。普通 Session 的 Prompt、Tool、Skill 和请求前缀保持不变。
