# V4.20 精确 durable feedback Skill 归因证据

> 后继 [V4.21](v4-21-existing-skill-improvement-investigation.zh.md) 已在该身份上增加 exact invocation-content hash，并允许同一内容版本的跨 Goal 纠正形成独立等待调查；本文“不能创建 existing-Skill Opportunity”和持久字段清单只描述 V4.20 当时边界。

## 结论

Opportunity 不再把“同 Session 唯一 Gap Skill”当作纠正归因。`dsh-evolve` 现在从 feedback 目标回答对应的原生持久化 Session 日志中，fail closed 地解析唯一成功 Skill 调用和当时的 Goal id/revision；无法精确解析的反馈仍可作为普通非因果信号保留，但不会进入某个 Skill Opportunity 的 correction context。

## 受保护边界

- 只接受目标 `assistant/message` 所在 turn 内的唯一直接用户消息和唯一成功 Skill 调用；user-explicit 与 model `skill` Tool 两条 DSH 原生路径分别有明确身份。
- model Tool 路径必须存在 source-linked、同 call id、非错误的 durable `tool/result`；调用失败、缺结果、多次调用或事件歧义均 abstain。
- Goal 由 DSH 官方 `foldGoal` 截止目标回答 seq 得出，不从当前 Session 状态或 Gap 猜测。
- Signal 只持久化 Skill 名、route、调用/回答 seq、turn、Goal id/revision；不保存反馈正文、用户消息、回答、Transcript、Skill body、cwd 或 host path。
- Opportunity 资格仍只来自同 Workspace、同 Skill、至少两个不同 Goal-linked Gap；精确纠正只作有界上下文，`causalClaim: none`，不能改变排序、author 输入、Candidate、晋升或发布权限。
- Web 分开显示“纠正的精确 durable Skill 调用归因”和“Delivery Outcome 的同 Goal 唯一 Gap 上下文”，不把后者伪装成 exact invocation，也不宣称因果。

## 自动化证据

- `durable-feedback-attribution.test.ts`：解析 model Tool 路径的 exact successful invocation 与 Goal。
- `feedback-signal-monitor.e2e.test.ts`：通过真实 Storage Domain 持久化 user-explicit invocation 归因并跨重启恢复。
- `skill-opportunity-discovery.test.ts`：弱 same-Session 信号被拒绝，exact invocation 信号才进入 correction context；distinct-Goal Gap 资格不受影响。
- `capability-gap-store.e2e.test.ts`：Gap、feedback attribution、Delivery Outcome 和 Opportunity v3 跨 Storage restart 恢复。
- `evolution-control-plane.test.ts` 与 Web client test：Host 只投影有界引用、exact correction Goal 计数和 `causalClaim: none`，浏览器明确展示两类不同强度的关联。

## 已执行验证

- 定向归因/恢复/控制面：5 files、27 tests 通过；其中 resolver 额外覆盖缺成功结果、多 Skill 调用、无 Goal 和目标回答不存在四类 abstain。
- 原生源码 Loader：`generation-store.e2e.test.ts` 与 `native-workspace-evolution.e2e.test.ts` 串行 9/9 通过。该门先发现并阻止了 Node strip-only 不支持 TypeScript parameter property 的真实启动错误，改为显式字段后复验通过。
- 根级 `pnpm check` 退出 0：文档链接/公开路径、十一包 typecheck、全测试、全构建均通过；`dsh-evolve` 为 63 files passed、1 skipped，303 tests passed、2 skipped；`dsh-evolve-web` 为 2 files、26 tests 通过。
- `pnpm test:cache-contract` 全通过：64-turn Gap Tool 稳定、GitHub Review composition、Goal cold resume、assembled delivery、飞书完整渠道 composition，以及十一包原生合同 22/22。
- 十一包最终 tarball 的 clean-profile add/dump/boot、真实 Session/Goal/Storage/Tool、dispose/remove、再次 boot/readback 为 1/1 通过（46.15 秒）；Doctor 独立 packed add/Loader/command/remove 为 1/1 通过（4.73 秒）。
- 重新构建 browser acceptance bundle 后，真实浏览器中 exact correction attribution、Delivery Outcome association 和 no-causal boundary 各唯一出现且布局为 `504×13`；刷新后仍各 1 条，页面 diagnostics 与浏览器 warn/error 均为 0，`ClawHub/Marketplace/Agent Skills/Skill acquisition` 均未出现。

这份证据不代表现有 Skill 再进化、返工/复用/负迁移完整归因、真实 provider、真实飞书或 Hermes paired 已完成。
