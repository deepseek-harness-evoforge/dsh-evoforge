# P1.6 证据：proposer 前 Case Pack 校准

> 日期：2026-08-16  
> 声明等级：`implemented`；证明零模型校准和 proposer 前 fail-closed，不代表 evaluator 已覆盖未知失败

## 用户结果

Case Pack 作者可以先执行：

```text
dsh-evolve calibrate --case-pack <case-pack-dir> --output <new-run-dir>
```

known-bad 被 evaluator 拒绝且 known-correction 被接受时退出 0，并生成
`calibration-report.json`。方向不匹配时退出 2 并保留可审计结果。命令不需要模型 route 或 API key，
不创建 Candidate，也不修改 Case Pack。

带完整 Trial/calibration 的正常 Shadow 现在自动执行同一 preflight；只有通过后才发送 proposer
请求。成功路径仍为四次 Trial，而不是在原四次之外新增两次。

## Test-first 行为证据

验收先以两个明确红灯固定缺口：CLI 把 `calibrate` 当成未知用法；方向错误的 known-correction
仍会先触发 mock provider。实现转绿后证明：

- 没有 model base URL/name 的子进程完成 known-bad fail / known-correction pass；
- 报告固定记录 `model.calls/inputTokens/outputTokens = 0`，且不包含环境中的 API key sentinel；
- Case Pack 前后逐文件内容完全相同，输出目录只含一个报告；
- 输出位于 Case Pack 内部时在任何写入前拒绝；
- known-correction 错误时得到 `not-calibrated + exit 2` 和完整两项结果；
- 完整 Shadow 在同样的错误 evaluator 上得到 `incomplete + exit 2`，provider request count 为 0；
- 既有反馈引导 Shadow仍是 baseline fail / Candidate pass，Trial count 仍为 4；
- paired Trial、DSH assembled Shadow、SIGKILL resume 和 feedback-guided CLI 重点回归为 23/23；
- macOS 固定 DSH assembled CI 选集显式包含新命令，本地为 60/60。

功能提交为 `a38c4313dc18baf08a39ff91cf92ad6e2cbba75b`。本地完整 `pnpm check`：`dsh-evolve` 113 passed / 2 skipped，
`dsh-software-delivery` 24 passed / 1 skipped，合计 137 passed / 3 skipped；docs、typecheck 和两个
包 build 同时通过。

该精确功能提交的公开 [CI run 31951011143](https://github.com/deepseek-harness-evoforge/dsh-evoforge/actions/runs/31951011143)
全部通过：Node 22.19.0 约 36 秒、Node 24 约 37 秒、macOS 固定 DSH assembled lane 约 1 分 38 秒；
两个发布 tarball 边界同时通过。

## Cache、成本与未完成边界

- 独立校准和 Shadow preflight 都位于离线 host plane；正常 DSH Session 的 Tool、Prompt、provider、
  Skill catalog 与额外 token 全部不变；
- 校准本身 proposer token 为 0。它增加的只是本来就属于 paired Trial 的前两次 evaluator 执行，
  完整成功 Shadow 仍共 4 次；
- evaluator 失准时节省原本可能发生的一次 paid proposer request 和反馈外发；
- 它不生成 evaluator。新失败仍需作者提供一个具体 evaluator、known-bad 和 known-correction；
- `calibrated` 不是“完美测试”的证明，真实 provider 改善率与 false-promotion 数据仍需长期测量。

设计取舍见 [ADR-0020](../adr/0020-calibrate-case-packs-before-proposals.md)。
