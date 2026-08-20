# V4.46 现有 Skill failed-Outcome Counterfactual Canary

日期：2026-08-21  
状态：`implemented`（Host/原生 Jobs/持久证据与自动化已验证；Control/Remote/Web、独立 rollback gate、最终 tarball 浏览器、真实 provider 与长期率尚未完成）

## 本增量回答的问题

V4.45 已证明 existing-Skill Candidate 能从最终 tarball 经人工批准、冷恢复和分步晋升进入未来 Session，但晋升后的真实失败 Outcome 还不会触发该 Candidate 自己的反事实复验。V4.46 增加独立 `ExistingSkillCounterfactualCanary`：失败 Outcome 只触发怀疑；只有 active Generation 恰好对应一条仍可重验的 approved existing-Skill release，才重放其 exact baseline/Candidate/Retention pair。

## 实现事实

- `ExistingSkillRetentionEvaluation.prepareCanaryReplay()` 重新读取权威 retained 结果、improved Holdout、原始完整 baseline、Candidate-bound Envelope 与独立 Retention Case Pack，重验两棵 Skill tree、两套 Case Pack、DSH revision 和全部 retained integrity gate后，在 Canary 自己的 run root 中物化 exact baseline/Candidate；它不运行 Trial，也不暴露 release writer。
- Canary identity 内容寻址绑定 policy、Workspace、active Generation、失败 Outcome、Candidate、Admission、Envelope、Holdout/Retention、两套 Case Pack hash、baseline/Candidate tree 和 DSH revision。active release 不唯一、lineage/Retention 漂移或 durable scan 有 warning 时，在任何付费 replay 前阻断或 abstain。
- replay 经原生 DSH Jobs 调度，`baselineKind=skill-tree`，proposer calls 固定为 0。Candidate 仍 pass 时 `keep`；只有 Candidate fail 且 exact baseline pass 才 `rollback-eligible`；baseline/Candidate 同时 fail 时 `review`，不把未隔离失败冒充负迁移。
- Trial 期间 active pointer 改变、输入变异、非 assembled、calibration/composition 失败均只产生 `review`。paid dispatch 后 Host 中断而结果未持久化时，重启写入 `canary-trial-outcome-uncertain`，不重复付费调用。
- durable result 的 status/reason/evidence 必须与 prepared identity 和分类函数重新一致；篡改 keep 为 rollback-eligible 后 scan warning 为 1 且不投影该结果。
- 该模块只依赖 Generation 读面，结果固定 `releaseAuthority: none`；没有 publish/promote/rollback/pointer 接口。它不是新 Runtime、审批体系、Gateway 或外部能力获取功能。

## 自动化证据

- 先建立 RED：`prepareCanaryReplay` 与 Canary 模块不存在。
- `existing-skill-retention-evaluation.test.ts` 固定 retained evidence 到 exact replay materialization 的边界。
- `existing-skill-counterfactual-canary.test.ts` 覆盖 keep、严格 rollback-eligible、双失败 review、active pointer 变化、durable 分类篡改、非 exact release abstain、paid-uncertain 冷恢复不重试及只经原生 DSH Jobs 调度。
- `dsh-evolve` typecheck、278 passed / 1 skipped 与 build 通过；全仓 `pnpm check` 以退出码 0 通过文档、11 包 typecheck、508 passed / 3 skipped 与全部 build。

## 尚未证明

- failed Delivery Outcome 目前只精确到 Generation，不宣称它因果归属于该 Skill；Canary 的 paired replay 才决定是否隔离出 Candidate 回归。
- `rollback-eligible` 仍没有 mutation authority；独立 existing-Skill rollback gate、人工确认、expected-active compare、Control/Remote/Web 和最终 tarball 浏览器恢复是下一门。
- fixture/确定性 Trial 不替代两套独立真实 provider、长期负迁移/误回滚率、真实飞书 exact route 或 Hermes paired benchmark，因此仍不能 tag 或声明上位替代完成。
