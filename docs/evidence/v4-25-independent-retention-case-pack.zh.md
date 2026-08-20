# V4.25 内部独立 Retention Case Pack 证据

> 声明等级：`implemented`。本证据只证明第五个内部 Goal 可在 Candidate 生成前被独立封存、形成 Candidate 不可见的 Retention Case Pack，并经 Host/Remote 投影到 DSH Web；它不证明 Retention Trial 已执行、Candidate 已保留或可以晋升。

## 行为

- `SkillEvaluationEvidenceVault` 在同一 Opportunity 有至少五个独立 Goal 时，从确定性排序中保留一个专属 `retention` 样本；author view 不包含其 objective，protected digest 进入治理身份。
- `SkillEvaluationGovernance.ensure()` 按 admission、holdout、retention 三个相互独立的角色依次 author；每次只接收该角色的一个密封 Goal，不接收 Candidate。三个 Case Pack 分别校准，任一内容 hash 复用都 fail closed。
- 四 Goal 路径继续生成 Envelope v4；含 Retention 样本时生成 Envelope v5，额外绑定 `retentionInputDigest`、Case Pack hash 和隔离 run root。
- Host 权威控制面和生成的 Typert Remote 只投影 Retention 数量、是否存在、阶段、调用/token 聚合与脱敏失败类型；不投影 Goal 内容、evaluator、provider identity 或路径。DSH Web 明示三角色治理和 Candidate 不可读性。
- 该增量不包含 Retention runner、自动晋升、canary 或 release authority。

## 验证

```text
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve-web typecheck
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve-web test
pnpm check
pnpm test:cache-contract
```

结果：`dsh-evolve` 48 个测试文件通过、1 个按环境跳过，179 个测试通过、1 个跳过；`dsh-evolve-web` 2 个测试文件、18 个测试全部通过。根级 `pnpm check` 的文档、11 包 typecheck、全部测试和构建退出码为 0；其中 Gateway 24、Telegram 26、飞书 34 项通过。Cache Contract 全部通过，Doctor 套件原生合同 22/22。生成 Typert artifact 已使用固定 DSH source revision 重建并通过 stale-artifact 校验。

## 未完成门禁

- exact Candidate 的 assembled Retention paired execution 与 durable result；
- Shadow、Retention、未来 Session Generation 与 Outcome 的同一谱系核验；
- 真实 provider、真实浏览器最终 tarball、长期负迁移与反事实 canary；
- Hermes paired benchmark 和任何发布/tag 声明。

后续状态：V4.26 已实现本页第一项的 exact Candidate paired execution 与 durable verdict；其边界和剩余门禁见 [V4.26 证据](v4-26-exact-candidate-retention-execution.zh.md)。本页仍只证明 Case Pack 生成时的事实。
