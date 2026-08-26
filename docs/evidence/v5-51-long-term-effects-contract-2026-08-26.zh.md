# V5.51：长期效果证据契约与只读汇总

日期：2026-08-26

## 目的

把发布门禁要求的长期指标（误晋升、遗忘、负迁移、重复外部效果、崩溃/重启恢复和回滚率）落成
一个可以由 `dsh-gateway`、`dsh-feishu`、评测器和控制面共同使用的 Host 契约。它不创建第二套
Runtime、Session、Goal 或审批体系，也不把时间上的先后关系伪装成因果结论。

## 已交付

- `dsh-evolve` 新增 `evoforge_long_term_effects` DSH Storage Domain。事实按内容寻址写入，重复写入
  幂等，关闭时等待写入尾部完成；超过上限只淘汰最旧事实。
- 四类输入事实有明确来源边界：`promotion-review`、精确 paired `paired-comparison`、带幂等键和
  duplicate-of 证据的 `external-effect`、以及 `crash/restart` `recovery`。外部适配器只能记录自己
  观察到的结果，不能给 Candidate 或 Generation 授予动作权。
- `LongTermEffectsProjection` 接入 `EvolutionControlPlane` 和 `EvolutionOverview`。Web 可以看到每个
  指标的 `measured`、`insufficient-sample`、`not-measured` 或 `unknown`，以及 observed/denominator/
  count/rate、来源计数和当前 DSH Delivery Outcome 数；所有输出固定 `causalClaim: none`、
  `releaseAuthority: none`。
- 回滚率只从 Generation Store 的不可变 selection events 计算；重复发送不会因“多次尝试”自动被判成
  重复外部效果，必须有相同幂等键、明确 `duplicateOfFactId` 和 Adapter 证据。
- `packages/dsh-evolve/test/long-term-effects.test.ts` 覆盖缺证据不误报、unknown/非 exact paired
  不计入回归、重复效果显式计数和 selection-event 回滚率。`dsh-evolve` 全测试 308 passed、1 skipped。

## 诚实边界

本次交付是生产可复用的持久事实与只读投影，不是长期效果门已通过。当前 profile 尚未由真实同任务、同
模型、同权限、同预算的 Hermes paired epoch 持续写入上述事实，因此六类指标在没有授权数据时会保持
`not-measured`/`insufficient-sample`，`release-gates.json` 仍然阻断发布。任何插件接入这些写入点后，
仍须通过反事实 canary、未见样本、权限/成本/cache 门禁和精确回滚验证，才能形成发布证据。

## 验证

```text
pnpm --filter dsh-evolve typecheck                         # passed
pnpm --filter dsh-evolve test -- long-term-effects.test.ts # passed (全包前置测试)
pnpm check:docs                                            # passed
```

