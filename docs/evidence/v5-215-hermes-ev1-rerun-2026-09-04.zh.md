# V5.215：Hermes EV-1 确定性控制面对照复跑

> 日期：2026-09-04。范围：在已审计、可构建的 DSH alpha.5 支持组合上复跑冻结的 Hermes EV-1 epoch-4；该试验不是模型质量、真实渠道或整体替代声明。

## 运行边界

- EvoForge DSH：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- Hermes：`29d0cc2602e01943ab300c0382fc9d97efb376da`
- 模型：`none`，修正内容是两边相同的冻结输入
- 网络：禁用；trial backend：`darwin-seatbelt`
- 比较范围：Skill correction release-control，包含校准、baseline/corrected、promotion、Session pin、
  cross-Workspace fail-closed、rollback/restart authority

## 结果

校准 `2/2`：known-bad 两边均 `fail`，known-correction 两边均 `pass`。最终：

| 指标 | EvoForge | Hermes |
| --- | ---: | ---: |
| baseline | fail | fail |
| corrected | pass | pass |
| final-test 前 active Skill artifact 修改 | 0 | 1 |
| baseline 评测期间保持 immutable | true | false |
| Candidate mutation 边界 | true | false |
| Session generation pin | true | false |
| rollback/restart exact | true | 未满足 |

运行命令：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm benchmark:hermes:ev1:alpha5:current
```

结果 JSON 与完整 stdout 保留在 `/tmp/evoforge-hermes-ev1-v5214-alpha5.log`。

## 解释与限制

该结果支持“在冻结 Skill 修正控制面中，EvoForge 保持 Candidate/评测/Session 边界而 Hermes 就地修改活动
artifact”的事实判断；两边 corrected 都 pass，因此不能据此推断模型效果更好。它不覆盖同模型真实 Provider、
多日负迁移/遗忘、真实 Feishu/Telegram、成本/cache、Approval/Schedule 或 npm 发布门禁。前一次未设置
alpha.5 支持目录的运行因 DSH revision `d347e703...` 与 manifest 期望不一致而退出；该失败保持为环境错配，
未改写 benchmark manifest 或结果文件。
