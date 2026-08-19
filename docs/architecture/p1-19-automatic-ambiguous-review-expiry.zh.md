# P1.19 自动模糊审查过期处置

> 当前状态：**已撤销**。自动 review expiry actor/policy 已删除；本页仅保留历史记录，当前 review 必须由权威状态和明确治理动作决定。

## 用户结果

对已经启用 Automatic Feedback Shadow 的 Skill，一个长期无人处理的模糊 Candidate 不再永久冻结后续
学习。候选完成后默认保留 168 小时；下一条同 Skill 自动反馈到来时，host 在预算和 provider 请求之前
把过期的 `recommendation: review` 持久化为自动拒绝，然后继续既有 P1.18 流程。原 Session、人工
Shadow 和其他 Skill 始终不等待。

这是一项 `dsh-evolve` Feature Extension：即使 DSH 完全正确，自动反馈部署仍需要一个有界的审查
保留策略，因此通过 upstream-fixed test。它不是通用 TTL、队列清理器或 DSH 修复。

## 最小契约

`automaticFeedbackTargets[].maxPendingReviewAgeHours` 是整数小时，范围 `1..2160`，默认 `168`。只有同时
满足以下条件的 Candidate 才会过期：

1. durable Shadow journal 同时记录 exact `feedbackSignalId` 和 `feedbackLaunchMode: automatic`；
2. Shadow 已完成，Review Candidate 仍为 `pending`；
3. evaluator 的结论恰好是 `recommendation: review`；
4. 从 Shadow 完成时间起已经达到配置时长；
5. 下一条同 Skill 自动 Signal 正在执行 P1.18 的预算前检查。

不满足任一项都维持 `busy`。因此以下状态绝不自动过期：

- 人工启动或旧版无来源标记的 Shadow；
- `recommendation: promote` 的明确候选；
- 已人工 disposition 的 Candidate；
- 已自动批准但 future-Session activation 尚未落盘的 Generation；
- 不可读、时间无效或证据不一致的状态。

处置复用既有 `review-state.json`，写入 `status: rejected`、
`actor: auto-review-expiry-v1` 和可读原因。原 proposal、report、diff、token、case 和 journal 全部保留，
`scanAll` 与控制面仍可审计；它不删除证据，也不改变任何 active Generation。

```text
next Explicit Feedback Signal
        │
        ▼
P1.18 Review Inbox preflight
        │
   stale automatic `review`?
      │             │
     yes            no
      │             │
durable reject    existing busy/clear rules
      │
re-scan → daily reservation → existing Shadow path
```

## 简洁性、缓存与权限

- 不增加 timer、watcher、queue、database、Service、Command、Tool、Skill 或 UI 动作；
- 只在已有 resident scan 因新 Signal 调用 inflight preflight 时运行，空闲成本为零；
- 正常 Session 的 Prompt、Tool Schema、Skill catalog 与顺序变化为 `0`，模型 token 增量为 `0`；
- 自动拒绝不发布、不激活、不回滚、不执行 Candidate，也不产生外部调用；
- 手工 `approve/reject` 仍使用原控制面；并发动作由既有 per-review 串行化保证一个 terminal disposition；
- durable write 失败或状态不可读时 P1.18 返回 `unknown`，预算与 provider 消耗均为 `0`；
- 卸载插件后只留下可读审计证据，不影响原生 DSH Session/Goal。

## 非目标

- 不替用户自动判断仍有明确价值的 `promote` Candidate；
- 不对 Evaluator Draft、进行中的 Trial 或自动批准但未激活状态设置 TTL；
- 不发送过期通知、不做后台清理、不建立 retention service；
- 不声称自动拒绝比例等于进化质量，真实 review-rate 与改善成本仍需长期测量。
