# V4.26 exact Candidate Retention 执行证据

> 声明等级：`implemented`。本页证明 Envelope v5 的独立第五 Goal Case Pack 已接入 exact Candidate 的持久配对 Retention；不证明自动晋升、canary、真实 provider outcome、长期保留率或 Hermes 上位替代。

## 行为

- `SkillCandidateAdmission.qualifiedShadowInput()` 在每次交接时重新解析 Envelope v5 的 Retention Case Pack/run root，并重算 Case Pack hash；v4 缺少该分区时保持 abstain。
- `SkillCandidateShadowLauncher` 在原有 DSH Jobs Shadow 任务内继续调用 `InternalSkillRetention`，没有创建第二 Runtime、第二 scheduler 或静态 Retention target。
- Retention 在 Trial 前重读 durable Shadow state/report，要求 Candidate、Admission、Envelope、Lineage v3、capability-absent subject、Candidate tree、holdout、DSH revision、promote paired evidence 和 composition 完全一致。
- Trial 使用 Candidate 不可见的第五 Goal assembled Case Pack，baseline/candidate 同预算配对，`proposerCalls` 固定为 0。只有 baseline 与 Candidate 均通过、校准通过、composition 相同且所有治理输入未漂移才写 `retained`；Candidate 单独失败写 `regressed`，其余不确定性写 `incomplete`。
- 运行按 Candidate/Admission/Envelope/Shadow/Retention Case Pack 内容寻址，加锁并保存 prepared identity 与 terminal `result.json`。重复调用复用结果；磁盘 verdict 的 status/reason/evidence 脱钩会 fail closed。
- 所有结果固定 `releaseAuthority: none`，当前 Session、Generation、review、promotion 与 rollback 均不被 Retention 直接修改。

## 自动化验证

```text
pnpm --filter dsh-evolve run typecheck
pnpm --filter dsh-evolve exec vitest run \
  test/internal-skill-retention.test.ts \
  test/skill-candidate-admission.test.ts \
  test/skill-candidate-shadow.test.ts
pnpm --filter dsh-evolve test
pnpm check
pnpm test:cache-contract
```

聚焦契约覆盖：Envelope v4 abstain、Envelope v5 handoff、exact Shadow lineage/parent、retained/regressed 结果、幂等复用、零重复 Trial、prepared/verdict/evidence 防篡改和同一 Jobs 接线。`dsh-evolve` 包级回归为 49 个测试文件、184 个测试通过，另有 1 个环境测试跳过。

## 未完成门禁

- Retention 结果进入未来 Session Promotion/rollback eligibility 的同谱系 gate；
- 反事实 canary、持续 outcome 与 negative-transfer/forgetting 监测；
- 两套独立真实 provider 的完整 admission→holdout→Retention outcome；
- DSH Web 的 Shadow/Retention 运行与 verdict 视图及真实浏览器失败恢复；
- 同条件 Hermes paired benchmark、真实飞书消息闭环和任何 tag/release 声明。
