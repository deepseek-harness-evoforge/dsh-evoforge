# V4.38 现有 Skill Candidate 不可见 Holdout 治理

日期：2026-08-21
状态：`implemented`（自动化验证通过；尚未执行 baseline/Candidate paired Trial）

## 本增量回答的问题

V4.37 只能证明 exact baseline/Candidate 双树结构完整，尚无证据证明 existing-Skill 的 holdout 在 Candidate 生成前由独立治理面形成。本增量把唯一 protected holdout 与 exact installed baseline 组合成 Candidate 不可见、完成 calibration 的 assembled `skill-tree` Case Pack，并将它设为 proposer 调用前的硬门禁。

## 实现事实

- 新 `ExistingSkillHoldoutGovernance` 与 capability-absent `SkillEvaluationGovernance` 分离；它不接收 Candidate、diff、claim 或 capability-absent subject。
- Host 从治理 Evidence Vault 重读唯一 holdout，重新验证 Opportunity/Qualification/Baseline/Evidence identity 和完整 baseline archive/tree；文本进入有界作者输入，binary 只提供 size/digest 元数据。
- proposer 与 governance author identity hash 相同会在 budget/model call 前阻断。
- governance author 只返回完整 replacement `SKILL.md` known-correction 与 assembled evaluator；Host 拒绝 name/license/permissions/allowed-tools 漂移，并把 baseline 的 references/assets/binary 原样继承进 synthetic known-bad 与 known-correction 完整树。
- Case Pack 固定 `trial.dshAssembled: true`、subject 为 `skill-tree`，不含 `capabilityAbsentBaseline`；Host 以零 proposer calibration 证明 known-bad fail / known-correction pass 后，才原子安装内容寻址 Envelope。
- state、binding、Case Pack 和扫描结果均持久化并重验内容身份；budget deny 可按 retryAt 恢复，paid-call uncertain 与 calibration failure 拒绝盲重试，全部固定 `releaseAuthority: none`。
- `ExistingSkillCandidateAuthoring` 在同一个原生 DSH Jobs task 中先调用 holdout governance；deferred/blocked 时不会占用 proposer budget，也不会生成 Candidate。ready Envelope id 写入 authoring state。
- Host/Remote/Web 新增独立 existing-Skill holdout governance 投影，显示 phase、baseline/qualification/evidence、成本、retry/failure 和候选不可见边界，不暴露保护正文、evaluator、provider identity 或 Host path。

## 自动化证据

- `existing-skill-holdout-governance.test.ts`：验证 Candidate-free author input、完整 Skill-tree calibration fixtures、binary metadata、同模型预算前阻断、budget durable defer、calibration fail-closed、paid-call uncertain restart 和 Web-safe scan。
- `existing-skill-candidate-authoring.test.ts`：验证原生 Jobs 中 holdout 必先于 Candidate proposer；holdout deferred 时 proposer budget/model call 均为零。
- `evolution-control-plane.test.ts`：验证 Envelope identity 与治理状态进入 Host 权威浏览器投影。
- `evolution-action.client.test.tsx`：验证 DSH Web 独立展示候选不可见 holdout、成本和无发布权边界。
- Typert 生成固定使用 DSH revision `47f943859bef60e4160492346772ded9b24f765a`；freshness gate 已更新。
- 根目录文档门禁、11 包 typecheck、全仓测试与全部 build 均以退出码 0 通过；`dsh-evolve` 为 235 passed / 1 skipped，`dsh-evolve-web` 为 20 passed。

## 尚未证明

- exact baseline 与 exact existing-Skill Candidate 的真实 assembled paired Trial、effect verdict 与 holdout 通过；
- existing-Skill Retention、Canary、future-Session promotion 和精确 rollback；
- 两套独立真实 provider、最终 tarball clean-profile、真实浏览器失败恢复和真实长期 Outcome；
- 同任务、同模型、同权限、同预算的 Hermes paired benchmark。
