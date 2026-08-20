# V4.27 Shadow/Retention 权威 Web 投影证据

> 声明等级：`implemented`。本页证明 DSH Host 与 Web 已能读取并解释 exact-Candidate assembled Shadow 和第五 Goal Retention 的真实持久制品；后续 [V4.28](v4-28-shadow-retention-real-browser.zh.md) 已补真实 DSH 浏览器刷新、断连和恢复。本页仍不证明 promotion eligibility、canary、真实 provider outcome 或 Hermes 上位替代。

## 行为

- `InternalSkillRetention.scan()` 有界读取配置中 Workspace-owned 的 `runRoot/retention` 内容寻址目录。缺目录表示尚无运行；prepared identity、terminal verdict、可选 model/token/cache 结构或内容地址不一致时计入 warning，不把结果伪装成成功。
- 扫描投影移除 `reportPath`。`EvolutionControlPlane` 继续复用 `ReviewInbox.scanAll()` 作为 assembled Shadow 的唯一权威读取者，不复制 Shadow/Retention 数据库，也不增加 scheduler、Runtime、Target 或模型调用。
- Host 只有在 Workspace、Skill、Candidate、Admission、Envelope、Shadow run、baseline tree 和 Candidate tree 全部一致时才把 Retention 附到 Shadow。不同 Candidate tree 的 `retained` 结果保持未配对并 fail visible。
- Browser-safe Remote 只显示 bounded holdout cases、trial、composition、Retention `prepared/retained/regressed/incomplete`、reason、calibration、proposer calls、evaluator model/token/cache 聚合和 Lineage v3 短身份；Goal 内容、Case Pack、evaluator、provider identity、proposal、Session 和 Host path 均不下发。
- DSH Web `Skills` 页新增 “Assembled Shadow and Retention” 区域，明确区分治理包 ready、确定性 Admission、实际 Shadow 和实际 Retention。每一行固定显示 `No release authority`；该视图不能 approve、publish、promote 或修改当前 Session。

## 自动化验证

```text
pnpm --filter dsh-evolve exec vitest run \
  test/internal-skill-retention.test.ts \
  test/evolution-control-plane.test.ts
pnpm --filter dsh-evolve-web exec vitest run \
  test/evolution-action.client.test.tsx
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve-web typecheck
DSH_SOURCE_ROOT=/absolute/path/to/pinned-deepseek-harness pnpm generate:typert
pnpm check
pnpm test:cache-contract
```

聚焦契约覆盖：durable Retention 扫描、status/reason/evidence/token 防篡改、无 Host path、exact lineage/tree 配对、错树不配对并告警，以及 Web 中 Shadow/Retention verdict、calibration、proposer=0、model/token/cache 和无发布权说明。生成 Typert 契约使用固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a`。根级结果为 `dsh-evolve` 49 files/186 tests passed、1 file/1 test skipped，`dsh-evolve-web` 2 files/18 tests passed；Gateway 24、Telegram 26、飞书 34、Doctor native contract 22/22，Cache Contract 全绿。

## 未完成门禁

- 把 exact Retention verdict 接入 future-Session promotion eligibility，而不影响当前 Session；
- 反事实 canary、持续 outcome、negative-transfer/forgetting 与精确回滚证据；
- 两套独立真实 provider、真实飞书用户消息闭环、同条件 Hermes paired benchmark 和任何 tag/release 声明。
