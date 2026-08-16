# P1.13 Automatic Retention Target 实现证据

> 声明等级：`implemented`。本页证明一个静态 exact Target 能自动闭合 P1.11 → P1.12；不声明完整
> 抗遗忘、Case 平台、真实 provider 净收益或生产可用。

## 用户断点

P1.12 已能阻止没有历史能力证据的自动晋升，但证据只能由人工 CLI 写入。对于常驻进程，这意味着每个
本来可自动处理的 clear-win Candidate 都会停在相同的机械步骤，无法持续运行。

P1.13 增加 `autoPromote.retentionTargets`。每个 Skill 只允许一个静态 exact prior Case Pack；配置是
明确的 evaluator 成本策略，而不是由模型或 Candidate 自行推断授权。

## Test-first 证据

定向 TDD 依次观察并转绿：

1. 缺少 `automatic-retention` module；
2. 同一 Skill 的第二个 Target 未被拒绝；
3. bounded/exact/absolute Target 约束未生效；
4. Trial 开始后丢失的 output 会被再次执行；
5. human-dispositioned Candidate 会错误地产生成本；
6. 操作者取消 native Job 后 Candidate 会在当前进程再次提交；
7. 真实 DSH 配置 Target 后仍不会自动产生 Retention evidence。

最终模块只公开一个 `scanOnce(signal)` orchestration interface；复杂度集中在 exact preflight、evidence、
content identity、单次执行和 native Jobs adapter 内。

## 真实 DSH 纵切

macOS 纵切使用 pinned DSH Storage、Agent、native Jobs、真实 ReviewInbox、Git Skill、P1.11 sealed
Retention 和 P1.12 release policy：

- `retained` 路径无需调用 CLI，自动执行四次 evaluator、写 exact report、发布 inactive Generation 并
  自动激活 future Session；
- `regressed` 路径写出 `baseline pass / Candidate fail`，Control detail 给出 exact 阻断原因，active
  Generation 保持为空；
- 两条路径 proposer calls 均为 0，完整 Agent request 数均无增量；
- enabled/disabled Target 的完整 native model request 逐字段相等，Target id/path/hash 不进入请求；
- packed profile 包含 Target 配置并完成 add/boot/dispose/remove。

## 崩溃与成本边界

单元纵切让 runner 在创建 content-addressed output 后丢失：首次扫描只报告 terminal report 缺失，后续
扫描识别同一 non-terminal output 且 runner 总调用数保持 1。human approved、rejected、activated 或
P1.1 preflight 不合格的 Candidate 均不触发 evaluator。native Job 在 output 前被操作者取消时，该
Candidate 在当前进程内被抑制；每轮最多一个自动 Target。

关键文件：

- `packages/dsh-evolve/src/automatic-retention.ts`
- `packages/dsh-evolve/src/automatic-retention-job.ts`
- `packages/dsh-evolve/src/retention.ts`
- `packages/dsh-evolve/test/automatic-retention.test.ts`
- `packages/dsh-evolve/test/generation-binder.e2e.test.ts`

本地单 worker 全量 `dsh-evolve` 为 165 passed / 2 skipped；PA-1 为 Evolve 54/54、Software
Delivery 22 passed / 1 skipped、Web 8/8、Telegram 22/22。全仓顺序复跑为 Doctor 5/5、Software
Delivery 26 passed / 1 skipped、Telegram 37/37、Web 9/9；全部构建、类型、文档链接与 diff check
通过。GitHub Node 22/24 + macOS assembled 结果以本 PR 终态为准。契约见
[P1.13](../architecture/p1-13-automatic-retention-target.zh.md)，决策见
[ADR-0033](../adr/0033-automatic-retention-is-one-static-target-per-skill.md)。

## 仍未证明

- 一个 prior Case Pack 不能证明全部旧能力；多个 Pack 的过期、冲突与 required/all/quorum 尚未设计；
- 没有真实 provider 的遗忘率、误阻塞率、自动 evaluator 单位成本与净收益；
- 首片仅 macOS sealed backend，没有陌生用户配置、磁盘耗尽与生产多日 soak；
- 不确定执行刻意不自动恢复，仍需异步人工检查或发布一个新的 exact Target version。
