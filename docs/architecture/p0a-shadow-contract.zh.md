# P0A Shadow 契约

> 状态：项目所有者已授权实现；安全门和一个 macOS 确定性校准/paired final-test 纵切已实现，完整 P0A 尚未完成
> 更新日期：2026-08-15
> 目标：用最小离线实验证明 evaluator 值得信任，而不是先建设在线自进化平台

## 1. 用户结果与非目标

P0A 只交付一个结果：

> 用户可以让 EvoForge 在隔离环境比较一个 active Skill 与 inactive Candidate，得到可重放的 `promote | review | reject` 建议；整个过程不修改 active Skill，不影响任何正常 DSH Session，也不产生外部副作用。

P0A 不提供常驻进程、在线观察、Generation pin、激活、回滚、审批队列、通用 optimizer API 或模型可见工具。这些能力只有在 evaluator 先证明有效后才有建设理由。

## 2. 唯一外部接缝

```text
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir>
```

输入：

- `<skill-dir>`：一个明确 owned、可读取但不可原地修改的 Skill 目录；
- `--case-pack`：版本化的任务、分区、检查器、预算和校准候选；
- `--output`：本轮唯一可写目录，保存候选、原始结果和报告。

行为：

- stdout 只输出一行人类摘要和报告路径；诊断写 stderr；
- `0` 表示评测完整结束，三种建议都属于正常业务结果；
- `1` 表示调用、配置或兼容性错误，未开始有效 Trial；
- `2` 表示预算、取消、执行或完整性问题导致评测不完整；若已经产生证据，仍写 `incomplete` 报告，但不得伪装成三种建议；
- 命令开始和结束时都校验 active Skill 内容哈希；不一致即为完整性失败；
- 除 `run-dir` 和隔离的临时 Trial workspace 外，不允许写入任何路径。

P0A 不发布 `Optimizer`、`Evaluator`、`CandidateStore` 或 `CaseLoader` 接口。它们是同一个用户结果的内部实现；出现第二个真实实现前，不为假想复用增加公共抽象。

## 3. 报告合同

`<run-dir>/report.json` 至少包含：

```ts
interface ShadowReportV1 {
  schemaVersion: 1
  run: {
    id: string
    status: 'complete' | 'incomplete'
    startedAt: string
    finishedAt: string
  }
  subject: {
    skillName: string
    baseTreeHash: string
    finalTreeHash: string
    unchanged: boolean
  }
  epoch: {
    dshRevision: string
    modelRoute: string
    modelConfigHash: string
    evaluatorVersion: string
    casePackHash: string
    casePackFinalHash?: string
    casePackUnchanged?: boolean
  }
  candidate?: {
    id: string
    treeHash: string
    parentTreeHash: string
    claim: string
    changedFiles: string[]
  }
  calibration: Array<{
    id: 'known-bad' | 'known-correction'
    expected: 'pass' | 'fail'
    actual: 'pass' | 'fail'
    passed: boolean
  }>
  cases: Array<{
    id: string
    partition: 'search' | 'selection' | 'final-test'
    baseline: 'pass' | 'fail' | 'incomplete'
    candidate: 'pass' | 'fail' | 'incomplete'
    checks: Array<{ name: string; passed: boolean; evidenceRef?: string }>
  }>
  composition: {
    baselineFingerprint: string
    candidateFingerprint: string
    allowedDifference: string[]
    cacheReadTokens?: { baseline: number; candidate: number }
  }
  budget: {
    candidateLimit: number
    trialLimit: number
    inputTokens: number
    outputTokens: number
    estimatedCost?: number
  }
  trial?: {
    backend: 'darwin-seatbelt'
    enforcement: 'full'
    count: number
  }
  decision?: {
    recommendation: 'promote' | 'review' | 'reject'
    reasons: string[]
    limitations: string[]
  }
}
```

报告保存哈希、指标、检查结果和本地 evidence reference，不默认复制 transcript、秘密、完整源码或用户内容。给定同一份已落盘 Trial 结果，Decision 必须得到相同输出；模型响应本身不承诺逐 token 重现。

## 4. Case Pack 与隔离

一个 case pack 只有四类事实：

```text
case-pack/
  manifest.json
  search/
  selection/
  final-test/
  calibration/
```

- `search` 可用于发现问题和生成 Candidate；
- `selection` 只用于候选间选择，不进入 proposer 上下文；
- `final-test` 在搜索和选择完全结束后只开放一次；一旦结果参与了下一轮修改，它就降级为 selection，并必须补充新的 final-test；
- `calibration` 保存已知坏 Candidate 和人工确认的真实修正，用来先证明 evaluator 的方向没有颠倒。

“未开放”不能只靠提示词约定。P0A 使用三道隔离：

1. proposer 是无工具的有界模型调用，只收到 active Skill、search evidence、单一 claim 和 patch 范围；
2. 每个 Baseline/Candidate Trial 在干净的受限 workspace 中运行，只挂载任务仓库和对应 Skill，不挂载 case pack、evaluator 源码或其他 Candidate；
3. Trial 退出后，由 host 侧 evaluator 注入或执行隐藏检查；Candidate 无权修改检查器、预算或 policy。

DSH `sandbox-local` 的公开契约是 same-world file-effect confinement，不能单独证明 Candidate 无法读取 case pack/宿主文件或使用网络。因此它可以成为写边界的一层，但不能被当作完整 Trial 隔离。没有能够证明声明的 read/write/process/network 边界的执行路径时，Shadow 必须返回 `2 + incomplete`，且不得执行模型生成代码；详细决定见 [ADR-0006](../adr/0006-fail-closed-sealed-trial-execution.md)。

公开仓库中的 final-test 只用于框架回归，不能证明真实泛化。一次有说服力的 P0A 退出试验还需要一个未参与开发、保存在用户本机的 final-test pack；报告只公开脱敏指标与哈希。

## 5. 第一个受管 Skill 与三个 fixture

首个受管对象固定为仓库中的 `build-dsh-plugin` Skill。它适合做试验，不是因为它最重要，而是其输出可以通过真实 DSH 组装和生命周期测试客观判断。

| Fixture | 用户任务 | Baseline 的可复现缺口 | Candidate 必须证明的改善 |
|---|---|---|---|
| `cache-safe-status` | 为插件展示时间、Goal、审批和进化状态 | 把动态状态写进每轮 system prompt 或新增状态 Tool | 状态只投影到 host/UI；模型调用数不增加；除被测 Skill body 外完整 composition 一致 |
| `dispose-owned-watcher` | 实现含 watcher/timer 的 Cordis 插件 | reload/unload 后仍有 handle 或重复注册 | 资源由 `ctx.effect()` 所有；组装测试证明 dispose 后零残留，reload 不重复 |
| `profile-install-remove` | 安装一个需要默认 profile patch 的插件 | Bundle 选择错误、配置行漂移或卸载后 DSH 不能原生启动 | 仅必要时使用 `dsh.bundle`；dump-config 精确；移除后无私有必需状态 |

每个 fixture 都运行真实的 parse/typecheck/test/组装路径，而不是只用字符串匹配。`calibration/known-bad` 故意违反对应不变量；`calibration/known-correction` 来自已经观察到的失败与修正。只有 evaluator 同时拒绝前者、接受后者，才允许评价模型生成的 Candidate。

## 6. Evaluator 与 Decision

评测顺序固定，Candidate 不能改写：

1. 输入完整性、owned path、Skill 格式和 active hash；
2. 权限、秘密、网络、Protected Action 和外部副作用差异；
3. fixture 仓库的 parse、typecheck、tests 与 build；
4. 真实组装后的 load、reload、dispose 和 removal；
5. reproduction 是否修复，selection/final-test 是否回归；
6. 完整模型 composition、cache-read、token、耗时和 Skill 长度；
7. 只有无法由上述证据判断的主观差异，才允许 blind model judge 补充意见。

Decision 是纯函数：

- 任一 hard gate 失败、没有修复 claim、出现 retained/final-test 回归，或校准失败：`reject`；
- 只有主观优势、样本不足、指标冲突、epoch 不可比或 scope 扩大：`review`；
- hard gate 全过、达到预声明 margin、没有回归且校准有效：`promote`；P0A 中这只是一条建议，绝不激活。

确定性 case 单次可判。含随机模型执行的 case 必须在 manifest 中预声明 paired 配置、最小复跑数和 tie policy；不足时只能 `review` 或 `reject`。模型 route/config、evaluator 或 case pack 改变即进入新 epoch，旧分数不可直接累计。

## 7. 预算与 KV Cache

P0A 的正常 DSH Session 增量为零：不安装在线 Provider，不注册 Tool，不写 system prompt，也不改变 Skill catalog。Shadow 的 token 全部属于用户主动触发的离线实验。

case pack 必须预声明 `candidateLimit`、`trialLimit` 和 token/cost cap；任一上限到达后停止并写 `incomplete`。相同 `epoch + baseTreeHash + caseId + compositionFingerprint` 的 Baseline 结果可以复用，Candidate 结果不能跨内容哈希复用。报告必须区分 input、output、cache-read，不能只给总 token。

## 8. 拟定红测试

测试只穿过 CLI、退出码、文件系统效果和报告这个公共接缝：

1. 完整 vertical slice：固定的系统边界模型返回已知坏 patch，命令完成、报告为 `reject`，active Skill 哈希不变；
2. 已知修正通过校准、selection 和 sealed final-test，报告给出 `promote` 建议但 active Skill 仍不变；
3. proposer 与 Trial 都无法读取 selection/final-test/evaluator；
4. Candidate 修改非 owned path、增加权限或改变非目标 composition 时被拒绝；
5. cache fixture 的动态 host 状态变化不增加模型调用，composition fingerprint 保持一致；
6. 预算耗尽、取消、崩溃或 epoch 不兼容返回 `2 + incomplete`，不能留下伪建议；
7. 同一落盘 Trial evidence 重放得到相同 Decision；
8. 无论成功、失败或取消，命令都只写 `run-dir`，临时 workspace 可安全回收。

当前实现先完成 owned-path safety tracer，再完成一条确定性纵切：固定模型只模拟外部 proposer 边界；真实文件、macOS Seatbelt、校准 evaluator、退出码和报告均不 mock。该纵切仍只把 Skill Candidate 当作数据做隐藏检查，尚未执行真实 DSH 组装任务，因此不能替代本节列出的三个 assembled fixture 和本地未见 final-test。

## 9. 人工介入与退出门

P0A 需要人工完成三件事：声明 owned Skill 和预算、提供/审核 final-test、查看第一份接受报告。这是实验校准，不阻塞任何原会话。

自动完成：候选生成、坏候选淘汰、Trial、报告、超预算停止和临时资源清理。P0A 不执行真正晋升，因此不存在前台审批等待。

只有同时满足以下条件才进入 P0B：

- evaluator 在重复运行中稳定拒绝所有 known-bad；
- 至少一个真实修正通过未参与搜索的本地 final-test；
- 没有 active Skill 写入、case 泄漏或非目标 composition 漂移；
- 报告能让不了解内部实现的人解释 claim、证据、成本和局限；
- 测得的收益值得其 token/cost，而不是只证明系统可以运行。

若做不到，结论是停止扩展或重写 evaluator，不是添加更多 Agent、Memory、Mission、工作流或发布基础设施。
