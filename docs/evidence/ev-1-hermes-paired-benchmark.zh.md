# EV-1 Hermes paired benchmark：Skill 修正发布控制面

> 日期：2026-08-17；状态：一个确定性 paired slice 已通过，不是全局 Hermes 上位声明

> 2026-08-24 可重放性复核：V5.13 已把 DSH release fixture 从删除后的 `GitSkillSource` 迁移到当前 sealed
> `skill-bundle` + `GenerationBundleRepository` 路径，并完整复跑四个 frozen Hermes epoch；本页 frozen result
> 未改写。详见 [V5.13 证据](v5-13-hermes-ev1-content-addressed-replay.zh.md)。

> 2026-09-04 当前基线复核：V5.123 在可构建 DSH alpha.5 上新增独立 epoch-2，使用新的 manifest/result
> 冻结同一确定性窄场景；epoch-1 与本页原始结果保持不变。当前结果仍只支持 Skill 修正发布控制面的
> `better` 结论，不支持模型质量、真实渠道或整体 Hermes 上位替代声明。详见
> [V5.123 证据](v5-123-hermes-ev1-alpha5-epoch-2-2026-09-04.zh.md)。

## 冻结范围

本轮只比较“一个已知错误的 Skill 收到同一条确定性修正后，如何验证并进入使用”这一发布控制面，
不比较模型生成质量，也不使用渠道、秘密或外部网络。epoch 固定：

- DSH `47f943859bef60e4160492346772ded9b24f765a`；
- Hermes Agent `29d0cc2602e01943ab300c0382fc9d97efb376da`；
- 同一 baseline、correction、known-bad、known-correction 和 final-test；
- 同一 macOS `darwin-seatbelt` sealed evaluator；
- 模型调用为 0，修正文案是两端共同的冻结输入；
- 非劣门：两端都必须得到 `baseline fail → corrected pass`；
- 预声明主指标：final-test 与显式 promotion 以前，被修改的 active Skill artifact 数，越少越好。

冻结 manifest、Hermes production-path fixture、runner 和原始结果分别位于
`benchmarks/hermes-v0.1/ev1-control-plane/`。复跑：

```sh
pnpm benchmark:hermes:ev1
```

runner 首先核对两个仓库的 exact revision；任一漂移都 fail loud。Hermes fixture 只把
`HERMES_HOME` 和 Skill 搜索根重定向到临时目录，实际写入仍调用该 revision 的 production
`tools.skill_manager_tool.skill_manage(create|patch)`；EvoForge 调用真实 sealed Trial、Git-backed
`VerifiedEvolutionStore` 与 DSH Storage Domain。临时目录在结束后删除，fixture 不发布、不进入任一
Bundle，也不是产品 CLI 或 Runtime。

## 结果

| 指标 / hard gate | DSH + EvoForge | Hermes |
|---|---:|---:|
| known-bad / known-correction 校准 | fail / pass | 同一校准 |
| baseline → corrected final-test | fail → pass | fail → pass |
| promotion 前 active artifact 修改数 | **0** | **1** |
| baseline 在 Trial 中保持 byte-identical | pass | fail |
| 当前 Session 在 promotion 后仍固定旧 Generation | pass | 无 Generation pin |
| 新 Session 使用 Candidate | pass | 无 Candidate/Generation 边界 |
| 跨 Workspace activation fail closed | pass | 不适用该边界 |
| rollback + Host storage restart 精确恢复 | pass | 本路径没有等价 release pointer |

两端都完成了同一确定性修正，所以 outcome 非劣门成立。EvoForge 的 Candidate 在 sealed final-test
前保持 inactive，显式 promotion 只影响未来 Session；旧 Session、另一 Workspace、rollback 和重启
均保持精确。Hermes `skill_manage(patch)` 在 final-test 前直接改变同一个 active `SKILL.md` 路径和
内容哈希。因此，本 epoch 支持的最窄结论是：

> `DSH + EvoForge` **better for deterministic Skill-correction release control**。

## 不支持的声明

这不是模型质量、真实 provider、软件交付、消息渠道、审批 UX、时延、token 成本或长期误晋升率
比较；样本数为一个确定性发布控制 case。它不能支持“全面优于 Hermes”或“Hermes upper
alternative”。完整 v0.1 paired pack 仍需同环境的软件交付、崩溃恢复、真实 Telegram/飞书消息与
审批，以及长期 outcome；没有凭据或同模型 route 时必须标记 incomplete/non-comparable。
