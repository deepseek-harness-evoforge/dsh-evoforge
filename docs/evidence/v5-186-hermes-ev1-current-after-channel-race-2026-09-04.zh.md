# V5.186：渠道竞态修复后的当前 Hermes EV-1 确定性复跑

> 日期：2026-09-04。范围：在提交 `36f0199` 后，使用同一已审计 DSH alpha.5 与当前 Hermes revision 复跑 Skill-correction release-control 对照。

## 结果

本次运行退出码为 `0`，校准 `2/2`：`known-bad` 仍为 fail，`known-correction` 仍为 pass。两边在同一修正输入下均得到
`baseline=fail / corrected=pass`。

| 指标 | EvoForge | Hermes |
| --- | ---: | ---: |
| final-test 与显式 promotion 前 active Skill 修改数（越低越好） | 0 | 1 |
| baseline trial 期间保持不可变 | true | false |
| 旧 Session 跨晋升保持固定代际 | true | false |
| 新 Session 使用 Candidate | true | 未提供 |
| 跨工作区 fail-closed | true | 未提供 |
| rollback/restart 精确 | true | 未提供 |

## 固定版本与边界

- DSH canonical `origin/master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`；运行支持 checkout：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- Hermes：`29d0cc2602e01943ab300c0382fc9d97efb376da`。
- EvoForge：`36f0199a6dc998cc5f31e3f20412057b4949da7d`。
- 运行命令：`DSH_EVOLVE_DSH_SOURCE_DIR=… EVOFORGE_HERMES_SOURCE_DIR=… EVOFORGE_HERMES_EV1_MANIFEST=benchmarks/hermes-v0.1/ev1-control-plane/manifest-alpha5-hermes-current-epoch4.json EVOFORGE_HERMES_EV1_EXPECTED_RESULT=benchmarks/hermes-v0.1/ev1-control-plane/result-alpha5-hermes-current-epoch4.json pnpm benchmark:hermes:ev1:alpha5:current`。

该结果只证明确定性 Skill 发布控制面的隔离、Session 代际和回滚门禁在本次渠道修复后没有回归；它不是同模型真实 Provider、真实渠道、长期负迁移或整体 Hermes 上位替代证明，因此 `hermes-paired` 与发布 tag 仍保持阻断。
