# P1.18 每 Skill 单未决自动进化门

## 用户结果

对启用了 P1.14 或 P1.16 的单机常驻部署，把短时间内同一 Skill 的多条明确纠正变成“一条正在处理、
其余留在既有 Signal Store 等待”的自动路径，避免在旧 Draft、Shadow 或 Candidate 尚未解决时重复
请求 provider、重复占用预算和堆积审批。产生纠正的 Session 和其他 Skill 继续运行。

它仍是 `dsh-evolve` 内部策略，不是新插件、队列或通用调度平台。即使 DSH 完全正确，该结果仍有独立
价值，因此通过 upstream-fixed test。

## 最小契约

自动入口在 durable UTC-day reservation 之前归约三个既有事实源：

| 事实源 | `busy` | `clear` |
|---|---|---|
| Evaluator Draft | 非当前 Signal 的 `authoring-pending/uncertain/draft-ready/qualification-running/incomplete` | `qualified/rejected`；当前 Signal 允许幂等 crash reentry |
| Shadow journal | 非当前 Signal 的全部非终态，以及任意 `candidate-ready/trial-running` | `complete/incomplete`；当前 Signal 的 `prepared/proposal-pending` 允许内容寻址 crash reentry，其无网络 Trial 仍由既有 supervisor 恢复 |
| Review Inbox | `pending`，或已自动批准但 future-Session activation 尚未 durable | 人工/自动 disposition 已完成，或没有 actionable Candidate |

管理该 Skill 的来源不可读时为 `unknown`；不管理该 Skill 的可选来源视为无关。组合规则为
`unknown > busy > clear`：只有全部
`clear` 才允许预算预留和后续可能付费动作。扫描读取全部 owned rows，而不是 Commands/Web 的 20 行
显示窗口。

```text
Explicit Feedback Signal
        │
        ▼
existing Draft + Shadow + Review facts
        │
   ┌────┴───────────────┐
 busy/unknown          clear
   │                    │
保留 Signal，后续再查   durable daily reservation
   │                    │
原 Session 不等待       existing author / Shadow path
```

## 简洁性与恢复

- 不复制 Draft、run、Candidate 或 Signal 状态，也不写新的 gate journal；新 Shadow 只在原 journal 增加
  一个 reference-only Signal id，供崩溃后区分“同一工作重入”和“新纠正”；
- 不创建 durable queue：Signal Store 已经保存待处理引用，resident 每轮仍最多启动一个；
- 同一进程只在 `busy/unknown` 状态变化时记录一次 warning，避免每轮日志刷屏；
- evaluator 与 Shadow 同一 Signal 的 pre-proposal 状态在重启后仍可进入既有内容寻址路径，读取 durable
  `uncertain/proposal-pending/draft-ready`，而无网络 Trial 继续由既有 supervisor 恢复；两者都不产生
  第二次 proposer/author 请求；旧版
  Shadow journal 没有 reference-only Signal id 时 fail closed；
- terminal Shadow failure 不永久占住 Skill；需要人工处理的 uncertain evaluator、proposal 或 Candidate
  则保持 `busy`，直到使用已有 reject/approve/promote/activation 路径处置；
- 人工显式 author/Shadow 是新的逐次授权，不经过自动 gate。

## KV Cache、权限与卸载

- 模型表面增量：`0`；无 Tool、Skill、system prompt、Schema、catalog 或顺序变化；
- gate 执行模型调用：`0`；`busy/unknown` 时预算消耗与私有内容外发均为 `0`；
- 只归约插件已有 owned host 状态；除上述 Shadow 引用字段外无新 authority，原 DSH Session/Goal 不变；
- 删除 `dsh-evolve` 或关闭 automatic Target 即删除该行为，没有额外状态需要迁移；
- 不改变 qualification、Promotion、merge、release、deploy、secret 或不可逆动作权限。

## 明确非目标

- 不做跨进程/跨机器锁、分布式 lease 或 exactly-once；
- 不自动合并、排序、总结或丢弃多个纠正；
- 不限制人工显式动作；
- 不以“一个未决”证明 Candidate 更好，也不替代日预算、Retention 或 rollback。
