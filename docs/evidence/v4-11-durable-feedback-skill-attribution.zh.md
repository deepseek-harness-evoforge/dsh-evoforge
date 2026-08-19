# V4.11 证据：Feedback Skill 由 durable Session 自主归因

> 当前保留：durable invocation 归因。历史 Feedback Draft/target 消费者已在 V4.24 删除；本页对应段落不构成当前运行时合同。

> 日期：2026-08-19
>
> 声明等级：`implemented`；只证明私有反馈样本的 Skill identity 不由用户或下游静态 target 选择

## 修正结果

公共命令从 `/evolve feedback <signal-id> draft <skill>` 收窄为：

```text
/evolve feedback <signal-id> draft
```

用户仍通过该 Protected Action 逐条授权复制最小 private feedback sample，但不再输入任务路径或 Skill。
Builder 重新读取当前 Message Feedback、pinned Generation 和 durable Session prefix，从 exact target turn
中要求并提取唯一 `skill-invocation`，然后核对 Generation 中恰好一个同名 immutable artifact。零个、多个、
非法或未被 pinned Generation 固定的 invocation 一律 abstain。

Feedback Shadow Launcher 和 Evaluator Draft Inbox 可以保留现有静态授权 target 作为治理边界，但它只能
核对，不能注入或覆盖归因；不匹配时在 Git materialization、Job 创建和模型请求前拒绝。

## Test-first 与门禁

- 红灯：先更新 Builder、Command、assembled command、Shadow 和 Evaluator 测试，得到 6 个预期失败，
  证明旧实现仍要求 caller 传 Skill；
- 直接回归：`feedback-case-draft`、`evolve-command`、`feedback-shadow-launcher`、
  `evaluator-draft-inbox` 合计 42/42；
- DSH assembled：固定 revision 的 `generation-binder.e2e` 精确 command path 1/1，通过真实 Agent/Skill/
  ToolSkill/Session Persistence/Message Feedback/Commands 组合；
- 全仓：`pnpm check` 通过，其中 `dsh-evolve` 262 passed / 2 skipped；
- 组合门：Cache Contract、Doctor 22/22 和十一包 clean-profile tarball
  add/dump/boot/remove/readback 通过，clean-profile 耗时 27.10 秒。

## 未完成边界

本增量没有改变 Skill Opportunity 的资格算法，没有证明 correction 与 Gap/Outcome 的因果关系，也没有
生成或晋升 Candidate。内部 Candidate admission/Shadow 仍依赖预配置 Skill 与 Case Pack；下一步必须让
Evaluation Governance Plane 从内部证据形成独立、候选不可篡改的 evaluation envelope/holdout，并在无独立
证据时 abstain。不得把本证据表述为自进化闭环或 Hermes 上位替代已经完成。

设计决定见 [ADR-0051](../adr/0051-feedback-draft-derives-skill-from-durable-invocation.md)。
