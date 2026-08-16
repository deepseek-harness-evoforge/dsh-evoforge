# P1.3 证据：显式负反馈学习入口

> 日期：2026-08-16  
> 声明等级：`implemented`；只完成安全、可撤回的 intake，不代表自动生成 Candidate 或持续进化已经完成

## 用户结果

同时启用 DSH 原生 Message Feedback 与 `dsh-evolve` 后，用户继续使用已有的逐消息负反馈和
备注 UI。无需 `/learn` 或第二套会话，host-only `/evolve status` 会显示当前保留的显式反馈
Signal 总数，以及归属于 active Generation（或 native DSH）的数量。反馈改成正向、删除或去掉
备注后，相应引用被撤回。

## Test-first 行为证据

红灯先固定了三个缺口：监听模块不存在、状态命令没有反馈聚合、真实 DSH Message Feedback 写入
后看不到学习信号。绿色实现覆盖：

- 只消费 DSH `message_feedback/sessions` 的 durable `domain/changed`；其他 Domain/Table 不进入；
- 只保留 `negative + non-blank note`，正反馈和无备注负反馈不形成 Signal；
- 完整 Session lifecycle 只在观察时用于精确 Generation 归属；记录不含 createdAt、cwd 或其
  hash，也不含 note、note hash、Prompt、Transcript 或消息正文，只含引用、opaque version、
  时间与 Session-pinned Generation；
- source whole-row 更新会原子替换派生 Session row，改为正反馈会撤回已有 Signal；
- 最近 1000 个 Session、每个 Session 100 条上限；已 durable 的派生引用可在 Storage 重启后恢复，
  旧 Session 以整行淘汰，不留下半条引用；
- 真实固定 DSH Agent 产生 assistant message，官方 `MessageFeedbackService.put` 写入负反馈，
  `/evolve status` 显示 `1 retained (1 active selection)`；改成正反馈后显示 0；
- 上述 DSH 服务写、状态读取和撤回前后，模型请求数不增加；插件卸载后原生 feedback 仍由 DSH
  持有，EvoForge 派生 Domain 可独立 reopen。

本地完整 `pnpm check` 通过：`dsh-evolve` 99 passed / 2 个显式 skip，
`dsh-software-delivery` 24 passed / 1 个显式 skip，合计 123 passed / 3 skipped；docs、typecheck、
两个包的 build 同时通过。测试命令和文件可由第三方直接复跑：

```text
pnpm exec vitest run test/feedback-signal-monitor.e2e.test.ts
pnpm exec vitest run test/generation-binder.e2e.test.ts -t "turns real pinned DSH message feedback"
pnpm check
```

公开 Draft PR 的功能 HEAD `3bd2fdc2ce11e0b8c43a79da0b33ce50e1321bb5`、CI run
`31948153426` 全部通过：Node 22.19.0 为 36 秒，Node 24 为 34 秒，macOS 固定 DSH assembled
lane 为 1 分 44 秒。macOS lane 显式包含新 feedback-signal Storage 测试和真实
`MessageFeedbackService.put` 集成，并继续复跑 sealed Shadow/canary、Jobs、Generation、
crash recovery、安装/卸载与 Software Delivery package boundary。

## Cache、权限与边界

- 新能力不增加 Tool、system prompt、Skill catalog 项、模型调用或动态 Session 前缀；额外模型 token 为 0。
- 它不读取 secret、不触发 Git/网络/付费/消息/日程或任何外部写入；原 note 只在 source event
  callback 内判断是否非空，不进入 EvoForge Storage。
- 监听异步且不阻塞原会话；source durable 到 derived durable 之间的极窄 crash window 允许少一条
  派生样本，原 DSH feedback 不丢失。
- 单条 Signal 不自动生成 Candidate、晋升或回滚。P1.3 还没有把这条新颖反馈转成可重放 Case，
  因此不能声称已完成 Hermes 上位或自进化闭环。

设计取舍见 [ADR-0017](../adr/0017-explicit-feedback-stays-reference-only.md)。
