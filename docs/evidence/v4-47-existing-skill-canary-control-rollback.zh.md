# V4.47 现有 Skill Canary Control/Web 与独立回滚门

日期：2026-08-21
状态：`implemented`（Host/Control/固定 Typert Remote/Web 与自动化已验证；最终 tarball 真实浏览器恢复、两套独立真实 provider 与长期率尚未完成）

## 本增量回答的问题

V4.46 已能从 active existing-Skill release 的失败 Outcome 形成无 mutation 权的 paired Canary 证据，但用户在 DSH Web 中看不到，也没有能把一条精确证据安全转换为 future-Session rollback 的独立写门。V4.47 完成这两条边界，同时保持 evaluator 与 pointer writer 隔离。

## 实现事实

- `EvolutionControlPlane.overview()` 只从 `ExistingSkillCounterfactualCanary.scan()` 投影有界权威状态：policy/warning、Generation/Outcome/Candidate、Admission/Holdout/Retention/Envelope、四棵内容 hash、paired outcome、integrity、model/token/cache 与 `releaseAuthority: none`。不下发 Host 路径、Skill 正文、保护 Case、provider identity 或凭据。
- 固定 DSH Typert 合同新增独立 `rollbackExistingSkill(workspaceId, canaryId)`；重新使用固定 revision 的官方生成器产出 Host/Remote schema，并通过 source digest、方法和参数 verifier。它不复用缺失 Skill 的可选 Canary/显式恢复动作，避免两类证据混淆。
- `ExistingSkillFutureSessionRollback` 是独立 Host mutation seam。每次人工请求重新要求 configured policy、零 warning、唯一 terminal result、当前 Workspace/active Generation、严格 `baseline=pass + candidate=fail`、assembled/calibration/composition/input/pointer 全稳定、proposer=0、trial=4 及四个 sealed hash；随后重新调用权威 `ExistingSkillRelease.eligibility()`，要求 approved Candidate/Admission/Holdout/Retention/Generation 与 Canary 全部一致。
- 门先精确解析 parent Generation，再把资格检查看到的 active id 传给 `EvolutionStore.rollbackGeneration(workspaceId, expectedActiveId)`；Store 串行临界区内的 compare-and-set 阻止检查后的 pointer 竞争。动作只改变未来 Session，当前已固定 Session 不漂移。
- DSH Web 新增 existing-Skill Canary 卡片和独立确认动作。页面展示 keep/review/rollback-eligible、失败归因边界与 evaluator 无写权；只有用户点击 exact Canary 行并二次确认后才调用 `rollbackExistingSkill`，不会调用旧 `rollback`。

## 自动化证据

- `existing-skill-future-session-rollback.test.ts` 先以缺模块 RED，随后覆盖 exact rollback、非隔离失败、durable warning、active Generation 错配和 approved release lineage 漂移；同时断言 mutation 收到 exact `expectedActiveId`。
- `evolution-control-plane.test.ts` 覆盖 bounded projection 和独立 Host action；`evolution-remote.test.ts` 固定生成 Remote 方法集合与参数转发。
- `evolution-action.client.test.tsx` 覆盖既有 Skill Canary 卡片、证据文案、二次确认、exact Canary id、独立 Remote 调用和刷新，且断言旧 rollback 未被调用。
- `dsh-evolve` typecheck/build、固定 revision Typert regeneration/freshness verifier、相关 Host 15 tests 与 Web 20 tests 通过；全仓 `pnpm check` 以退出码 0 通过文档、11 包 typecheck、515 passed / 3 skipped 与全部 build。

## 尚未证明

- 本增量的浏览器证据来自组件级真实 DOM 行为，不替代最终 `dsh-evolve`/`dsh-evolve-web` tarball 的 clean-profile 安装、reload、Host 失败、同 profile 恢复、实际 rollback、Session 固定与卸载；该门是下一增量。
- 确定性 fixture 不替代两套独立真实 provider、长期负迁移/误回滚率、真实飞书 exact route 或 Hermes 同条件 paired benchmark，因此仍不能 tag 或声明上位替代完成。
