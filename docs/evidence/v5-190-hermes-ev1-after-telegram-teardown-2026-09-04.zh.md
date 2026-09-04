# V5.190：Telegram teardown 修复后的 Hermes EV-1 复跑

> 日期：2026-09-04。范围：在 `c7fdc19` 渠道生命周期修复后，以同一 DSH/Hermes revision 复跑确定性 EV-1 控制面基准。

## 结果

运行退出码 `0`，校准 `2/2`；EvoForge 与 Hermes 均保持 `baseline=fail / corrected=pass`。EvoForge 在 final-test 与显式 promotion
前修改 active Skill `0` 个，Hermes 为 `1` 个。EvoForge 的 baseline 不可变、旧 Session 代际固定、未来 Session 使用 Candidate、跨工作区
fail-closed 与精确 rollback/restart 门禁均为 `true`；Hermes 的 production artifact 原地修改仍被记录。

固定 DSH canonical `origin/master` 为 `76fda729799fe9b3848dbe2c211d4b231032b81e`，运行支持 checkout 为
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；Hermes revision 为 `29d0cc2602e01943ab300c0382fc9d97efb376da`。运行使用
`pnpm benchmark:hermes:ev1:alpha5:current` 与当前 epoch-4 manifest。

该结果只是确定性 Skill 发布控制面复验，不是同模型真实 Provider、真实渠道、长期负迁移或整体 Hermes 上位替代证明；发布门禁继续
`blocked`，未创建 tag。
