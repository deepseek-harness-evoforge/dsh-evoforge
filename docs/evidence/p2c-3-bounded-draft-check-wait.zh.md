# P2C.3 证据：bounded exact-head Draft checks 等待

> 日期：2026-08-17  
> 声明等级：`implemented`；有界 active-call wait，不是后台 CI 平台

## 用户结果

部署者显式开启后，`complete_delivery` 可在同一次 Tool 调用内等待 exact Draft PR 的 CI 从
pending/尚未出现变为绿色；期间不需要新的模型轮次。失败、head 漂移、取消和 timeout 均保持
Goal active，merge/ready/release 权限不变。

## Test-first 证据

红灯先固定旧行为会在第一次 pending 立即返回。绿色实现覆盖：

- pending → missing → green：一次调用完成，push/list 各一次，只读 checks 三次；
- failed：第一次读取立即返回，不 sleep；
- wrong exact head：即使 checks 绿色也立即 fail closed；
- wait 期间 local HEAD 或 worktree 漂移：green 后的 final local recheck 拒绝完成；
- timeout：返回最后一份 bounded counts 与 `unknown/checks-timeout`；
- cancel：等待立即传播取消；
- timeout/进程中断后的新调用：重新验证并复用同一 remote Draft，create 次数为零；
- wait 关闭时继续保留 P2C.2 的单次 `pending|missing` 结果；
- host wait 配置前后完整 Tool Schema 相等，仍小于 2 KiB。

## 当前验证结果

- `dsh-software-delivery`：34 passed / 1 skipped；typecheck、build 通过；
- pinned real DSH Goal/ToolGoal/native Bash/Agent assembled completion 通过；
- packed tarball add/boot/remove、built CLI 与卸载后 native Skill composition 通过；
- PA-1：`132 passed / 1 skipped`；串行全仓：`272 passed / 3 skipped`，docs、typecheck 与 build
  全绿；标准本地并行门只命中未改动 Telegram package 的既有 `dist/index.mjs` clean 竞态，独立
  重建后 Telegram 为 37/37；
- exact commit `8ba18f3da4f6c65d017529e1abc773f00cb05b22` 的
  [Draft PR #19](https://github.com/deepseek-harness-evoforge/dsh-evoforge/pull/19) 真实 live gate
  从 `statusCheckRollup=[]` 开始，在同一个 `complete_delivery` 调用内经历 pending，215.28 秒后
  三项全绿并完成 native Goal；artifact 为 `reused: true`，没有创建第二个 PR；
- 同一 exact commit 的 GitHub Actions `31981275970`：Node 22、Node 24、macOS DSH Assembled
  Trial 全部成功，PR 保持 Draft、base `feat/p1-qualify-and-shadow`、merge state `CLEAN`。

## Cache、权限与恢复

等待策略只存在于 host config。Tool Schema、Skill 文本和正常请求 composition 不变；等待期间
provider 调用为零。每个 poll 仍通过原生 shell Tool，sandbox/Approval/guard 权威不变。GitHub
branch、Draft PR 和 exact-head checks 是恢复事实；没有 CI journal、daemon、Job 或后台 watcher。

## 边界

当前读取全部 rollup checks，不解释 required-only branch protection，也不下载或诊断 CI 日志。
只支持既有 GitHub.com 同仓 Draft PR 路径；fork、GHES、其他 forge、自动修复和自动 merge 不在
本片范围。生产长 CI 的取消率、平均等待时长和真实任务 token 节省仍待长期数据。

设计见 [P2C.3 契约](../architecture/p2c-3-bounded-draft-check-wait.zh.md)与
[ADR-0038](../adr/0038-draft-check-wait-is-bounded-and-call-scoped.md)。
