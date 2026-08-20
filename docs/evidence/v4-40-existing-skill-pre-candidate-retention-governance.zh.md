# V4.40 现有 Skill Candidate 前 Retention 治理

日期：2026-08-21
状态：`implemented`（自动化与 Host/Web contract 已验证；Retention Trial、真实 provider 和最终 tarball 浏览器尚未完成）

## 本增量回答的问题

V4.35 已把第五个独立 Goal 保留为 Candidate 不可见的 `retention` 样本，但 V4.38 的 existing-Skill Envelope 只生成 Holdout。若直接在 V4.39 verdict 后创建 Retention 测试，Candidate 身份不会证明评测集在其生成前已经封存。本增量先修正这条身份链，不执行 Retention，也不授予晋升权。

## 实现事实

- `ExistingSkillHoldoutGovernance.ensure()` 对四 Goal 仍只处理 Holdout；五 Goal时按 `holdout → retention` 顺序进行两次独立治理作者调用，每次只接收 exact baseline 和自己的一个 protected Goal，输入不含 Candidate、diff、claim 或另一个角色的纠正。
- 两个角色分别产生完整 `skill-tree` known-bad/known-correction/evaluator Case Pack，并在不同目录完成零 proposer calibration；任一角色缺失、校准失败、内容相同或身份漂移都阻止原子安装。
- `existing-skill-evaluation-envelope-v3` 把 Holdout hash、可选 Retention hash、各自 protected-input digest、baseline、Evidence Seal、治理模型与固定 DSH revision 一并内容寻址。Candidate 现有 `holdoutEnvelopeId` 字段继续绑定整个 Envelope id，因此五 Goal Candidate 的内容身份同时固定两套评测材料。
- 四 Goal Envelope 明确投影 `retentionIncluded: false`；五 Goal Envelope 投影 `true`。历史 v2 Envelope 与历史无 `pendingRole` 的 Holdout pending state 保持可读，后者升级后转为 durable `uncertain`，不会重发已经 dispatch 的付费调用。
- Host control plane 与 `dsh-evolve-web` 显示治理阶段、当前 role、是否已封存 Retention、两次调用的聚合 token 成本、失败类别和无发布权；不显示保护正文、evaluator、provider identity 或 Host path。

## 自动化证据

- `existing-skill-holdout-governance.test.ts` 从 `ensure()/resolve()/scan()` 公共接缝证明：五 Goal 只进行两个单样本调用、两套 Case Pack 独立、Envelope 同时绑定两 hash、第二次付费结果未知不重试，以及 V4.39 legacy pending state 安全迁移。
- 完全相同的 Holdout/Retention evaluator 会在 calibration 和安装前被拒绝，不能依靠不同 role 或 input digest 产生的 manifest hash 冒充独立评测。
- `evolution-control-plane.test.ts` 和 `evolution-action.client.test.tsx` 固定 Retention presence、成本与 Candidate-blind Web 表达；generated Typert Host/Remote 与固定 DSH revision 同步。
- 当前包级结果：`dsh-evolve` 251 passed / 1 skipped，`dsh-evolve-web` 20 passed；根级累计 480 passed / 3 skipped；最终 `pnpm check` 以退出码 0 通过文档、11 包 typecheck、全部测试与 build。
- 本增量不把确定性测试执行器、Web fixture 或治理 ready 冒充 Retention 效果。后续 [V4.41](v4-41-existing-skill-exact-retention-evaluation.zh.md) 已增加 `ExistingSkillRetentionEvaluation`、原生 Jobs 恢复与 exact assembled Trial；最终 tarball 浏览器和真实 provider 仍未完成。

## 发布边界

- 所有 Envelope、治理状态和 Web 投影固定 `releaseAuthority: none`；没有 Candidate 执行、Generation、晋升、Canary 或 active pointer 写入。
- 两套独立真实 provider、existing-Skill Retention/Canary/晋升/回滚、真实飞书 exact route 和 Hermes paired benchmark 仍阻止 tag 与完成声明。
