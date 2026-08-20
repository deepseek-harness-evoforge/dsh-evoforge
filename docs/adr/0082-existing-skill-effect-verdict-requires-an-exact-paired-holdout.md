# ADR-0082：现有 Skill 效果判决必须来自精确成对 Holdout

- 状态：Accepted
- 日期：2026-08-21

## 背景

V4.37 的结构准入只能证明 Candidate 完整继承 exact installed baseline，并且实际差异没有越过声明边界；V4.38 的治理只能证明 protected holdout 在 Candidate 前独立形成并完成 calibration。两者都没有执行 baseline 或 Candidate，因此不能给出效果判决。若直接把结构通过、Candidate 自评或一次普通执行当作改善，会让 proposer 事实上兼任裁判，并掩盖 baseline 本来就能通过、Candidate 未修复或反向退化三种结果。

## 决策

1. 新增独立 `ExistingSkillHoldoutEvaluation`，只接收 `qualified-for-holdout` 的 exact Admission、同一完整 baseline Bundle、同一 Candidate 与该 Candidate authorship/content identity 已经绑定的 exact Candidate-blind Holdout Envelope。Candidate 未绑定、Envelope id 错配或 lookup tuple 只能定位到另一个 Envelope 时，均在 Candidate 物化和 Trial 前失败关闭。运行身份内容寻址绑定 Candidate、Admission、Envelope、Workspace、Skill、Opportunity、Qualification、baseline、三棵树和固定 DSH revision。
2. baseline 与 Candidate 都作为完整 `skill-tree` 在同一 assembled DSH Trial 中执行；Case Pack 必须是已校准的 assembled contract，不得含 capability-absent baseline。两侧使用同一任务、权限、预算和非目标 composition。
3. Trial 前后重算 baseline、Candidate 与 Case Pack tree hash。只有 known-bad/known-correction calibration、assembled execution、非目标 composition 一致、输入完整性和固定四次 Trial 全部成立，结果才可分类。
4. `fail/pass` 为 `improved`；`pass/pass` 为 `ambiguous`；`fail/fail` 为 `not-improved`；`pass/fail` 为 `regressed`。完整性门失败为 `incomplete`，物化漂移为 `protected`，均无效果判决。
5. 付费 Trial dispatch 前持久化 `trial-pending`。进程在结果落盘前中断时，重启固定给出 `paired-trial-outcome-uncertain`，不得盲目重复模型调用；普通明确失败持久化为 `paired-trial-failed`。
6. exact qualified Admission 是原生 DSH Jobs 的 durable restart queue；启动扫描与实时 Admission 回调进入同一调度缝隙。评测器、Candidate 和 Web 均没有晋升、激活或发布接口，所有结果固定 `releaseAuthority: none`。
7. DSH Web 只显示权威、脱敏的身份、三棵树、四项门禁、双方结果及模型/token/cache 计数；不显示 Host path、protected case、evaluator、provider identity 或 Skill 正文。

## 后果

- “结构正确”和“效果改善”成为两个不可混淆的证据层；
- Candidate 本身证明其生成前 Holdout Envelope，评测不能依赖事后可替换的条件查找重新选择裁判；
- `improved` 只表示该 exact Candidate 在这一个 Candidate-blind protected holdout 上独立改善，不等于 Retention、长期有效或可发布；
- existing-Skill 仍需独立 Retention、Canary、future-Session promotion 与 rollback，不能复用 missing-Skill 的 capability-absent 语义；
- 两套独立真实 provider、长期 Outcome 与 Hermes paired benchmark 继续作为发布门禁。
