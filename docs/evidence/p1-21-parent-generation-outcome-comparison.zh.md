# P1.21 父版本交付结果对照实现证据

> 日期：2026-08-17；分支：`feat/p1-generation-outcome-comparison`

## 结果

`dsh-evolve` 现在能在 Commands/Web 中同时显示 active Generation 与 exact parent/native DSH 的
passed/failed/unknown 观察计数。两处都明确禁止因果推断；数据仍来自既有 P2D.1 bounded store，未新增
采集、持久状态、模型调用或 release 行为。

## Red → Green

- Red：旧 `summarize` 只有 all/selected，Commands、Control Plane 与 Web 无法给出 parent 对照。
- Green：同一次 store 遍历增加可选 baseline counter；active 不存在时不产生对照。
- 真实 Storage：native 与 active outcome 各写一次、重复 call 去重，重启后 exact 三个 bucket 可恢复。
- 反误导门：Commands 与 Web 都固定显示“观察计数不能证明 Generation 导致差异”；没有百分比、评分或
  自动动作。

## 已执行验证

- 聚焦 host：Commands + Control Plane 23 tests passed。
- `dsh-evolve-web` component：14 tests passed；新增 active/parent 对照与免责声明分支。
- `dsh-evolve` 全套：40 files passed / 1 skipped；196 tests passed / 2 skipped。
- `dsh-evolve-web` 全套：2 files / 15 tests passed。
- PA-1 聚合：155 passed / 1 skipped（Evolve 90、Delivery 29/1、Web 14、Telegram 22）。
- 串行完整 workspace：287 passed / 3 skipped（Doctor 5、Evolve 196/2、Delivery 34/1、Web 15、
  Telegram 37）。
- 真实固定 DSH ToolRuntime/Commands：1 passed / 18 skipped；native 与 active Session 分别执行同一个
  `complete_delivery`，重复 call 仍幂等，`/evolve status` 显示 exact parent 对照且模型请求增量为 `0`。
- 真实 Storage Domain：1 passed；baseline bucket 在 close/reopen 后保持一致。
- 真实 Chrome：活动 `3/4`、父版本 `2/4` 计数、免责声明与显式 Refresh 均可见；控制台 error 为 `0`。
- 五包 typecheck/build、文档链接、Typert freshness 与 Node artifact gate 通过；Remote 方法集合不变，只
  增加 optional baseline counter。
- 标准并行 `pnpm check` 通过：文档、五包 typecheck、287/3 workspace tests 与五包 build 全绿。
- packed `dsh-evolve`：1 passed；真实 profile `plugin add → boot → plugin remove → native boot` 通过。
- 远端 Draft PR checks 见本分支最终检查记录。

## Cache、权限与限制

- 模型可见表面、正常 Session token 与新增模型调用均为 `0`。
- Remote 只增加可选的四计数字段；个体 outcome、Session、Goal、commit 与 PR number 不进入浏览器。
- 最近 1000 条的 active/parent 任务组合可能不同；本功能只提供观察线索，不能证明收益或支持自动 release。
