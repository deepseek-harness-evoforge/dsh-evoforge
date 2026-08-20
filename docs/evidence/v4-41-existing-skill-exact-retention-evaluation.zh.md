# V4.41 现有 Skill 精确 Retention 评测

日期：2026-08-21
状态：`implemented`（自动化与 Host contract 已验证；DSH Web 视图的最终 tarball 真实浏览器、两套真实 provider、Canary/晋升/回滚尚未完成）

## 本增量回答的问题

V4.40 已在 Candidate 生成前把第五个独立 Goal 变成单独校准、内容寻址的 Retention Case Pack，但尚未执行它。V4.41 增加独立 `ExistingSkillRetentionEvaluation`：只有同一 Candidate 的权威 `improved` Holdout 才能触发 exact Retention，且 Retention 仍只是未来晋升门禁的输入，不是发布决定。

## 实现事实

- `ExistingSkillRetentionEvaluation.evaluate()` 先经 `ExistingSkillHoldoutEvaluation.scan()` 重读唯一、无 warning、完整且全部 integrity gate 为真的 `improved` Holdout，再重验同一 Workspace、Candidate、Admission、Envelope、baseline/Candidate tree、Holdout 与 Retention Case Pack hash、固定 DSH revision 和四次 Trial 契约。
- 四 Goal或 legacy Envelope 没有独立 Retention 分区时返回非持久 `abstained / no-independent-retention-case`，不调用 Trial，也不伪造保持证据。
- 五 Goal路径重新物化 exact baseline 与 whole-tree Candidate，执行独立 `skill-tree ↔ skill-tree` paired Trial。`fail/pass`、`pass/pass`、`fail/fail`、`pass/fail` 分别持久判为 `retained`、`ambiguous`、`not-retained`、`regressed`；只有第一种证明 Candidate 保持了受保护纠正。
- 运行目录按 Candidate、Holdout、Admission、Envelope、baseline/Candidate tree、两套 Case Pack、policy 与 DSH revision 内容寻址。Trial 前先写 `trial-pending`；若进程在付费 dispatch 后未持久观察到结果，冷恢复写入 `paired-trial-outcome-uncertain`，不得再次调用 Trial。
- Trial 返回后重新计算 baseline、Candidate、Retention Case Pack 和 Holdout Case Pack hash；任何内容、composition、calibration、assembled、Trial 数或 usage 形状漂移都产生 incomplete 或扫描 warning，不能形成 retained 证据。
- `ExistingSkillRetentionEvaluationScheduler` 只把实时或冷扫描得到的 exact `improved` Holdout 交给原生 DSH Jobs；没有第二调度器、Session、Goal、Agent Runtime、daemon 或 release mutation seam。
- Host control plane 只投影有界 identity、状态、四象限 verdict、integrity gate、成本/时延/cache usage 和 `releaseAuthority: none`，不下发保护 Goal、Case 内容、evaluator、provider identity 或 Host path。

## 自动化证据

- `existing-skill-retention-evaluation.test.ts` 从 `evaluate()/scan()` 公共接缝覆盖：exact Retention 成功、四 Goal无花费 abstain、四象限、原生 Jobs 冷/热唤醒、Holdout Case Pack 运行中漂移、负 usage 篡改、假 retained gate 脱钩和 paid dispatch 崩溃后不重试。
- `evolution-control-plane.test.ts` 固定 Host 权威投影；Trial 只在外部 Adapter 接缝替换，baseline/Candidate/Envelope/Holdout/Retention、文件系统与 durable recovery 均使用真实模块。
- 包级结果：`dsh-evolve` 61 files/261 tests passed、1 file/1 test skipped；`dsh-evolve-web` 2 files/20 tests passed。根级 `pnpm check` 以退出码 0 通过文档、11 包 typecheck、全量 490 tests passed/3 skipped 与 build。

## 发布边界

- 本增量不包含 DSH Web Retention 组件与最终 tarball 真实浏览器验证，也不包含真实 provider、Canary、future-Session Promotion 或精确回滚。
- Retention 结果固定无发布权；两套独立真实 provider、真实飞书 exact route、Hermes paired benchmark 和长期负迁移/误晋升/误回滚数据仍阻止 tag 与完成声明。
