# P1.2 证据：零提案模型的反事实 Canary 与可恢复回滚

> 日期：2026-08-16  
> 声明等级：`implemented`；本地与公开固定 DSH macOS executor 均已通过

## 用户结果

显式启用 `autoPromote.skills` 的用户获得一个保守的晋升后安全网：失败交付不会直接回滚，而是异步
复用原 Shadow Case Pack，把当前自动 Candidate 与其不可变 Git 父版本放进同一个校准过的
Sealed Trial。只有“校准通过、parent 通过、Candidate 失败、active 未变化”才为未来 Session
回滚；其他结果保持或进入异步 review，原交付会话不等待。

## Test-first 行为证据

- 单元红灯先固定了 attributable rollback；随后覆盖 Candidate 仍通过保持、pointer commit 后崩溃
  的 exactly-once 恢复，以及 Trial 期间 active 改变时绝不误回滚；
- macOS E2E 使用真实 Git 两个 commit、原 Case Pack hash、known-bad/known-correction 和
  Seatbelt executor，证明精确 parent pass / Candidate fail，且删除所有 proposer 模型环境后仍可运行；
- `runPairedTrial` 支持 exact Candidate tree，四次 Trial 的临时副本可写、源物化缓存保持只读；
- DSH Jobs Adapter 测试覆盖 bounded label/output、完成与取消；固定 DSH Jobs integration 验证
  canary 出现在真实 `evolution` Job registry；
- 固定 DSH 全链 E2E 真正完成自动晋升、新 Session Generation pin、原生 ToolRuntime 失败结果、
  Outcome 落盘、resident scan、原生 Job、四次 Sealed Trial 与 `keep` 决策；active pointer 和模型
  请求数均未变化；
- journal 在 Trial 前写 `trial-running`、pointer 前写 `rollback-pending`，指针已提交而结果未落盘时
  重启只补齐一次；
- 同一不可变 Generation 的多个失败 Outcome 只触发第一轮 canary，runner 调用次数被测试固定为 1；
- runner 校验原 run、Case Pack hash、DSH/evaluator epoch、reviewed content hash 与 Git artifact；
  漂移时 fail closed，不生成回滚结论；
- 不新增 Tool、Prompt、Skill catalog entry、system prompt、Goal、daemon 或外部 API。

本地全仓结果：`dsh-evolve` 95 passed / 2 explicit skips，`dsh-software-delivery` 24 passed /
1 explicit skip，合计 119 passed。另用固定 DSH checkout 单独运行真实 Jobs、Generation binder 和
sealed canary 集成，13 passed；完整 macOS 固定 DSH lane 也在提交前运行，34 passed。

公开 Draft PR CI run `31946719396` 在 exact head `550be84bf05121f54a101d67c51d21788d261055`
通过：Node 22.19.0 为 38 秒、Node 24 为 31 秒、macOS 固定 DSH assembled lane 为 1 分 50 秒。
macOS lane 明确包含新增 sealed canary runner、真实 Jobs Adapter 和完整自动晋升→失败 Outcome→
canary 装配链。

## 成本与 Cache

Canary 不调用 proposer，模型 token 增量为 `0`；每个自动晋升 Generation 最多消耗四次本地
evaluator/DSH fixture 的 CPU 与墙钟时间。若 Case Pack 的 trusted evaluator 自身显式装配模型，该 evaluator 的既有成本仍
按 Case Pack 预算计算，不能被描述为免费。正常 Session composition 完全不变；动态 Outcome、
canary journal 和 Job 状态只在 host plane，因此不改变 DSH KV Cache 前缀。

## 尚未证明

- 它不会重放触发它的真实开发任务，只能证明原 retained Case Pack 上 Candidate 相对 parent 的
  回归；新失败转成脱敏、可重放 case 仍是后续能力；
- 真实开发任务上的 false promotion、false rollback、review rate 与返工减少；
- Linux/Windows sealed executor；
- 多日常驻、磁盘耗尽和大样本 Case Pack 保留策略。

设计决策见 [ADR-0016](../adr/0016-rollback-requires-counterfactual-canary.md)。
