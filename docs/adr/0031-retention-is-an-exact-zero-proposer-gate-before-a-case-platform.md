# ADR-0031：先做 exact 零 proposer Retention Gate，不建设 Case 平台

## 状态

Accepted，2026-08-17。

## 背景

P1.10 已经闭合“明确纠正 → Evaluator Draft → 人工资格验证 → Shadow Candidate”，但一次 Shadow
只回答“Candidate 是否改善当前 Case Pack”。它没有回答更重要的长期问题：Candidate 是否破坏了
以前已经成立的能力。Hermes Self-Evolution、Canvas Meta-Agent 与 DGM 都保留 dataset/archive，
但公开证据仍未证明长期 retention；只继续增加 proposer、Memory 或自动循环会放大抗遗忘缺口。

另一个候选痛点是后台结果难发现。源码审计确认 DSH 已通过原生 Jobs、`session/jobs` 推送和 Web
Jobs UI 展示 unowned EvoForge Job。再建通知中心会重复原生能力；把任务绑定原 Session 则会注入
完成消息、可能唤醒模型并永久进入历史，违背 KV Cache 第一优先级。

## 决策

新增一个 host CLI 动作：

```text
dsh-evolve retain --run <completed-shadow-run> \
  --case-pack <trusted-prior-case-pack> --output <new-retention-run>
```

首片只接受一个已经 `complete`、推荐为 `promote|review` 的 exact Shadow Candidate。它从 durable
run 恢复 baseline Skill 与 proposal，重新验证 primary report、proposal hash、baseline tree 和原
Case Pack hash，再对一个独立 prior Case Pack 执行既有 sealed calibration + baseline/Candidate
paired Trial。

结果只有三态：

- `retained`：prior baseline pass，exact Candidate 也 pass，且非目标 composition 不漂移；
- `regressed`：prior baseline pass、Candidate fail；
- `incomplete`：输入漂移、calibration 失准、baseline 本来就不 pass、隔离不可用或证据不足。

Retention 不调用 proposer、不生成第二个 Candidate、不修改原 run、active Skill、Generation 或 review。
CLI 显式调用是本次 Trial 的授权；中断后不自动重试。报告包含 exact source run、Candidate、Pack
hash、逐 check、Trial 数与可见的 evaluator model-call/usage 证据。

## 为什么先离线

直接把多 Case replay 塞入 promotion 会同时改变 Shadow journal、恢复协议、预算、Web 确认和自动
晋升安全门，尚未证明用户确实能捕获一次真实回归。一个 exact run + 一个 prior Pack 足以验证核心
假设，并可在下一片直接成为 release gate；没有第二种真实需求前不抽象 Case SDK、suite registry、
dataset service 或 optimizer adapter。

## 后果

- 用户首次能证明“新 case 变好、旧 case 没忘”，而不额外花 proposer token；
- report 是独立 evidence，不会被误当成 Promotion；
- 操作者暂时需要 host path，适合实验与 CI，不冒充完成的自动 retention；
- 若前向证据成立，下一片将 exact retention result 绑定 review evidence，晋升前 fail closed；若不
  成立则停止，不扩建多 Case 平台。

## 拒绝方案

- **通知插件**：DSH native Jobs/Web 已有，重复且可能污染模型历史。
- **把旧经验写进 system prompt/Memory**：增加长期 token，且出现内容不等于能力保留。
- **同一模型自评 retention**：与 proposer 相关偏差，不能成为发布证据。
- **立即自动回放全部历史**：成本、epoch、过期与冲突语义尚未验证。
- **修改 active Skill 后跑测试**：破坏 immutable Generation 与可回滚边界。
