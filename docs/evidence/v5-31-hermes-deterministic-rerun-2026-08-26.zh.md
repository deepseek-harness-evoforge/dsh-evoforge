# V5.31：Hermes 冻结四 slice 当前重跑

- 日期：2026-08-26
- EvoForge：当前 `main`（`29352e2321ad1d1a58feed41689e5c4e60ac4dac`）
- DSH：`0.1.0-rc.5`，`47f943859bef60e4160492346772ded9b24f765a`
- Hermes：`29d0cc2602e01943ab300c0382fc9d97efb376da`
- 命令：`DSH_EVOLVE_DSH_SOURCE_DIR=/tmp/dsh-evoforge-rc5-git pnpm benchmark:hermes`

## 当前结果

四个冻结 deterministic slice 均通过 runner 的 exact result 校验：

| slice | EvoForge | Hermes | 结论 |
|---|---:|---:|---|
| EV-1 Skill correction release control | 0 | 1 | EvoForge 在 Candidate/Generation 边界和 Session pin 上更严格 |
| SD-1 checked Goal completion | 0 | 1 | EvoForge 拒绝 failed check 被标记完成 |
| LC-1 local crash recovery | 0 | 0 | 有界本地恢复平局 |
| AS-1 Telegram approval/replay | 0 | 0 | 一次性授权身份与 replay 控制平局 |

四个 slice 都明确排除模型质量、真实 Telegram/飞书消息、Provider 成本/延迟、长期负迁移和整体 Hermes
上位结论。此次增量只让 runner 支持通过 `DSH_EVOLVE_DSH_SOURCE_DIR` 选择与 manifest 匹配的 DSH checkout，
避免默认 rc.2 checkout 误撞历史 rc.5 manifest；没有改写冻结结果。

