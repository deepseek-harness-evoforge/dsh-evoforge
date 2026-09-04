# Hermes 当前 revision 复核（2026-09-04）

本页是对先前生态审计的增量复核；旧日期报告和旧 benchmark epoch 保留，不被静默改写。

## 源码事实

| 仓库 | 当前本地 `HEAD` | 远端 | tag 描述 | 工作树 |
|---|---|---|---|---|
| Hermes Agent | `29d0cc2602e01943ab300c0382fc9d97efb376da` | `origin/main` 同 revision | `v2026.8.13-104-g29d0cc2602` | clean |

本轮先执行 `git fetch origin --tags --prune`，再核对 `HEAD == origin/main` 和 clean worktree。旧的
`63279301…`（V5.135 epoch-3）不再称为 current；它仍作为历史可复现 epoch 保存。

## 对 Hermes EV-1 基准的影响

原 `benchmark:hermes:ev1:alpha5:current` 因 manifest 固定旧 revision 而在入口校验阶段拒绝运行，退出码 `1`；
这不是能力回归，也不能通过跳过 revision 校验掩盖。本轮新增 epoch-4 manifest/result，改用当前 Hermes `29d0cc2…`，
保留相同冻结 case pack、DSH alpha.5、无网络、darwin-seatbelt、2 个 calibration case 和非模型质量的 release-control
范围。重跑结果：校准 `2/2`，两侧 baseline `fail`、corrected `pass`；EvoForge primary metric `0`、Hermes `1`；
EvoForge 的 baseline 不可变、Session pin、future-Session candidate、跨 Workspace fail-closed、rollback/restart
exact 全部为 `true`，Hermes 对应 candidate boundary/session-generation gate 仍为 `false`。

该结果只证明当前 Hermes revision 下的确定性 Skill-correction release control 优势，不证明模型质量、真实渠道、
长期自进化或全局 Hermes 上位替代。真实 paired benchmark 门禁继续保持 `partial`。
