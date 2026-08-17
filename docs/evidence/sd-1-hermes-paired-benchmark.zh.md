# SD-1 Hermes paired benchmark：确定性检查完成控制

> 日期：2026-08-17；状态：一个确定性 paired slice 已通过，不是完整软件交付或全局 Hermes 上位声明

## 冻结范围

本 epoch 只比较“已有 committed change 的任务，能否在 deterministic check 成功/失败时正确改变
权威任务状态”。不比较编码模型质量、Draft PR、远端 checks 或 reviewer。配置固定为：

- DSH `47f943859bef60e4160492346772ded9b24f765a`；
- Hermes Agent `29d0cc2602e01943ab300c0382fc9d97efb376da`；
- 两个从同一 `main` 创建的 linked worktree，各自领先一个 commit；
- 同一个 `quality` argv check：通过 case 退出 `0`，故障注入 case 退出 `4`；
- 模型与网络均关闭；两端 completion surface 接收同一冻结 check outcome；
- 非劣门：通过 case 两端都能完成；
- 主指标：failed-check task 被接受为 complete 的次数，越少越好。

冻结 manifest、Hermes fixture、runner 和原始结果在
`benchmarks/hermes-v0.1/sd1-completion-control/`。复跑：

```sh
pnpm benchmark:hermes:sd1
```

DSH 侧对真实 linked worktree 执行 `verifyDelivery`，并额外重跑 production `complete_delivery`
Tool 的两个 native Goal contract：pass 后通过 `update_goal` 完成，fail 后保持同 revision active。
Hermes 侧在隔离 `HERMES_HOME` 创建、claim 两个真实 goal-mode Kanban task，再调用 production
`tools.kanban_tools._handle_complete`；没有 patch completion 逻辑，也不直接修改 SQLite。

## 结果

| case / 指标 | DSH + EvoForge | Hermes |
|---|---:|---:|
| check exit `0` | Goal complete | task done |
| check exit `4` | Goal active；`check-failed:quality` | task done |
| failed-check completion 次数 | **0** | **1** |
| native Goal pass/fail contract | pass | 不适用 |
| auxiliary goal judge | 不依赖 | unavailable，按 Hermes 当前设计 fail open |

通过 case 非劣门成立。故障 case 中，Hermes handoff metadata 明确记录 exit `4`，但在辅助 goal judge
不可用时 `kanban_complete` 仍接受 completion；EvoForge 的检查是 completion Tool 内的强制门，失败
不会调用原生 `update_goal`。本 epoch 支持的最窄结论是：

> `DSH + EvoForge` **better for deterministic checked Goal completion control when the Hermes auxiliary goal judge is unavailable**。

## 不支持的声明

这不代表 Hermes 在配置了可靠辅助 judge 时仍会接受失败，也不比较两端实际写代码的能力、模型
token/延迟、GitHub Draft PR 或真实 reviewer。它不能支持“软件交付全面优于 Hermes”或全局上位
声明；同模型真实任务、远端 review/checks 与长任务样本仍需独立 epoch。
