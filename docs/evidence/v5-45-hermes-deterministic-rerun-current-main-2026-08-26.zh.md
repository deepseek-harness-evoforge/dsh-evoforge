# V5.45：当前 main 的 Hermes 四 slice 重跑

- 日期：2026-08-26
- EvoForge：`main`，`6e354776a001bbb9da97e8738bcd2d86630dcb47`
- DSH：冻结 epoch 使用独立的 `0.1.0-rc.5` checkout，`47f943859bef60e4160492346772ded9b24f765a`
- Hermes：`29d0cc2602e01943ab300c0382fc9d97efb376da`
- 命令：`DSH_EVOLVE_DSH_SOURCE_DIR=/tmp/dsh-rc5.IerI3l pnpm benchmark:hermes`
- 退出码：`0`

## 结果

| slice | EvoForge | Hermes | 结论 |
|---|---:|---:|---|
| EV-1 Skill correction release control | 0 | 1 | Candidate/Generation 边界和 Session pin 更严格 |
| SD-1 checked Goal completion | 0 | 1 | failed check 不会被标记为完成 |
| LC-1 local crash recovery | 0 | 0 | 有界本地恢复平局 |
| AS-1 Telegram approval/replay | 0 | 0 | 一次性授权和 replay 控制平局 |

四个结果均通过各自冻结 `result.json` 的 exact 校验；没有改写历史结果，也没有把确定性切片扩展成模型质量、真实渠道或整体 Hermes 上位结论。

## 边界

该重跑证明当前 `main` 仍能复现四个冻结的确定性对照。它不覆盖真实 Provider、真实飞书/Telegram 外部效果、同模型编码质量、长期误晋升/负迁移/遗忘，也不解除发布门禁。
