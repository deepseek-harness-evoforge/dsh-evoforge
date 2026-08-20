# V4.31 failed Outcome → sealed counterfactual canary 证据

> 声明等级：`implemented`。本页证明内部新 Skill 的失败 Outcome 能触发 exact、零 proposer、内容寻址的 canary evidence，并投影到 DSH Web；不证明真实 provider、真实浏览器故障恢复、自动回滚、长期误回滚率或 Hermes 上位替代。

## 修复的活动断点

V4.30 后的活动链只到 Retention 与 future-Session Promotion Eligibility。`DeliveryOutcomeMonitor` 虽能在 DSH durable checkpoint 后记录失败，但没有把失败交给后续健康验证；旧 canary 又依赖已撤销的 Git source/ref、静态 target 和直接 pointer 写权限，不能恢复使用。

本增量从现有 internal Candidate 证据重新设计：失败 Outcome 只是触发器，canary 不把该真实 Goal 冒充成因果可重放 case，也不搜索或获取外部 Skill。

## 当前活动合同

- `DeliveryOutcomeMonitor` 只在一条新 durable Outcome 成功创建后发出有界回调；回调失败不丢失 Outcome，冷启动重复投影不重复唤醒。
- `CounterfactualCanaryScheduler` 只使用原生 DSH Jobs 的 `evolution` kind，负责进程内观察、取消和启动恢复，不创建第二调度器或 Runtime。
- Host 先重验 active Generation 仍满足 `FutureSessionPromotion.eligibility`，且相对 parent 只新增一个 exact internal `skill-bundle`。
- Review、Retention、Candidate、Admission、Envelope、Lineage、capability-absent subject、baseline/Candidate tree 与 Retention Case Pack 必须唯一且完全一致。
- run id 绑定 Workspace、Generation、Outcome、Candidate、Review、Retention、Admission、Envelope、Case Pack 与两侧 tree hash；prepared/result 均严格校验身份和 verdict/evidence 关系。
- Trial 使用已密封 assembled Retention Case Pack、零 proposer、同一 pre-Candidate subject 与 exact Candidate。baseline 通过且 Candidate 失败才产生 `rollback-eligible`；两侧均通过为 `keep`；其他情况为 `review`。
- 输入漂移、active pointer 漂移、非 assembled、calibration/baseline 失败、composition 变化、歧义、篡改或已 dispatch 但结果不确定均 fail closed。中断后不会盲目重跑付费 Trial。
- 每 Workspace 使用现有 candidate evaluation policy 的持久日预算。`keep` 后另一条失败可继续监测；`review` 或 `rollback-eligible` 会停止该 active Generation 的进一步花费，等待独立 Host action。
- Canary 依赖只读 Generation 接口，结果固定 `releaseAuthority: none`；它不能修改 active pointer 或当前 Session。独立 rollback execution gate 在本增量仍是后续工作，现已由 [V4.32](v4-32-exact-canary-rollback-gate.zh.md) 补齐自动化实现。

## Web 与类型契约

- Host Control Plane 只读扫描 owner state，并投影 `prepared / keep / review / rollback-eligible`、bounded ids、baseline/Candidate、calibration、assembled、composition、输入完整性、pointer 稳定性、trial、model/token/cache 和原因。
- 浏览器不接收 Host path、protected Goal/Case、evaluator、provider identity、Candidate body 或 proposal。
- Skills 视图明确显示“仅为证据，不能移动 Generation pointer”，渲染不会调用 rollback；同时把当前 internal `skill-bundle` 正确计入 active Skill。
- Typert Host/Remote/Client 契约由固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 重新生成并通过 freshness verifier。

## 自动化覆盖

`counterfactual-canary.test.ts` 固定以下边界：

1. exact regression 只生成 rollback eligibility，active pointer 不变；
2. exact pass 生成 keep，篡改 terminal verdict 后扫描告警；
3. Case Pack 在 Trial 中漂移会留下可读 `review`，不会把结果重新绑定到漂移内容；
4. dispatch 后中断不盲重试；
5. pointer 漂移降级为 review；
6. 日预算耗尽不 dispatch；
7. rollback eligibility 未处理时不重复花费；
8. keep 后的后续失败继续监测；
9. Generation delta 歧义阻断；
10. reconciliation 只通过一个原生 DSH evolution Job 运行。

另有 Delivery Outcome durable wakeup、Control Plane browser-safe projection、Web rollback-eligibility 只读展示、internal `skill-bundle` active 投影、配置契约和 packed runtime surface 回归测试。

固定 DSH revision 下重新生成 Typert 后执行：

```sh
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve-web test
pnpm check
```

结果：`dsh-evolve` 51 files passed、1 skipped，203 tests passed、1 skipped；`dsh-evolve-web` 2 files / 20 tests passed；全仓文档、typecheck、test、build 门禁退出码为 0，共 432 tests passed、3 skipped。

## 未完成门禁

- V4.31 时 rollback 按钮尚未由 exact Canary eligibility 独立授权；后续 [V4.32](v4-32-exact-canary-rollback-gate.zh.md) 已增加人工确认的 exact evidence action，但仍不等于无人值守自动回滚；
- 尚未从最终 tarball 在 clean profile 中用真实 provider 跑 assembled canary、故障注入、浏览器断连/恢复和卸载；
- existing-Skill 完整 baseline Bundle/Candidate 尚未接入同一 Retention/canary 链；
- 真实飞书 exact route、长期误晋升/误回滚/负迁移数据和同条件 Hermes paired benchmark 尚未通过。

因此不创建 SemVer tag，不发布 v0.1，也不声称完整自我进化或 Hermes 上位替代已经完成。
