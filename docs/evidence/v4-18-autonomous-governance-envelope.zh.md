# V4.18 — 从密封内部 Goal 证据形成治理 Envelope

日期：2026-08-19
状态：`implemented`，真实 provider assembled 验收 pending

## 要证明的窄结论

一个内部 whole-Skill Candidate 必须显式绑定生成前的 `Skill Evaluation Evidence Seal`。在没有人工预置 Envelope 的情况下，Evaluation Governance Plane 能从该 seal 的受保护 admission/holdout 子集分别形成 Case Pack，且治理作者不读取 Candidate artifact；两份包经零 proposer 校准后按 `Opportunity/evidence-seal` 内容地址原子安装。该流程不安装、激活、晋升或发布 Candidate。

## 实现证据

- Candidate schema/store 升级为 v2，`evaluationEvidenceId` 进入持久 authorship 与 Candidate 内容 id；Vault 校验只读取 Candidate 自身绑定的 seal，不允许调用方另传一个替代 id。
- `SkillEvaluationGovernance` 是治理深模块：唯一写入 seam 是 `ensure(candidate metadata)`；另有有界脱敏只读 `scan` 供 Host/Web 解释状态。内部读取 exact seal，分别构造 admission/holdout author 输入，两份输入均不包含 Candidate 文件、正文或 id。V4.19 进一步修正两种执行协议，见 [后续证据](v4-19-governance-admission-handoff.zh.md)。
- proposer 与治理面用同一 secret-free、endpoint/model 规范化函数计算 provider identity；治理作者与 Candidate proposer 的 model identity hash 相同时，在预算预留和作者调用前 fail closed，不能让 proposer 兼任自己的评测作者。
- 每个治理作者调用前先持久化 `authoring-pending`；dispatch 后结果不可确认时，下一次启动写入 `uncertain` 并拒绝模型重试。
- 两份 Case Pack 必须分别通过现有 zero-proposer `calibrateCasePack`；任一 `not-calibrated`/`incomplete` 都阻止 Envelope。
- Envelope v4 路径为 `envelopes/<opportunity-id>/<evidence-seal-id>`，manifest 绑定 Workspace、Opportunity 快照、seal、governance model identity hash、admission/holdout input digest、capability-absent baseline hash 和两份不同 Case Pack hash。
- Lineage v3 与 Web projection 显式携带 seal id，形成 `Opportunity → evidence seal → Candidate → Admission`。
- 启用 `selfDiscoveryPolicies` 的 Workspace 必须在对应 evaluation policy 固定 exact DSH revision；配置仍不能命名 Skill、baseline、Case Pack、Candidate 或进化方向。

## 自动化结果

- `skill-evaluation-governance.test.ts`：从四个内部 Goal 的 seal 自动形成 Envelope；治理作者各只看到一个 protected Goal，作者输入中不存在 Candidate；两次 calibration 后 baseline 仅含 `subject.json`；同 proposer model identity 在预算前被拒绝。
- 同一测试覆盖 paid-call crash：第一次请求 dispatch 后断线；重建模块后进入 `uncertain`，模型调用保持一次，预算预留保持一次，无 Envelope。
- `skill-candidate-repository.test.ts`、`skill-evaluation-evidence-vault.test.ts`、`skill-candidate-lineage.test.ts` 均执行红→绿，证明 seal 进入 Candidate identity、Vault binding 与 Lineage。
- `pnpm --filter dsh-evolve test`：62 个文件通过、1 个条件跳过；295 项通过、2 项条件跳过，含 provider identity 规范化单测。
- 根级 `pnpm check`、`pnpm test:cache-contract` 均退出 0；Doctor 原生插件合同 22/22。
- 十一包最终 tarball 的 clean-profile add/dump/boot/原生 Session+Goal+Tool/dispose/remove/reboot/readback 1/1 通过（32.79 秒）；`dsh-doctor` packed add/Loader/command/remove 1/1 通过（4.20 秒）。
- packed `dsh-evolve` 含治理 API、Candidate/Lineage seal 声明，不含已删除的 acquisition、ClawHub 或 research Candidate 声明。
- `dsh-evolve-web` 26/26 通过；从最终源码构建 acceptance bundle 后，真实浏览器中 Candidate 卡片与 active lineage 的 evidence seal 都是唯一且有非零布局的可见元素，reload 后仍恢复，刷新前后 console warn/error 均为 0。该证据是源码 acceptance bundle，不冒充真实 provider 或最终 tarball Web 整链。

## 明确不证明

- 注入式 Case Pack author/calibration 不是实际 provider 成功率，也不证明生成 evaluator 语义可靠。
- 尚未用真实 provider 对真实未见 Goal 跑完 capability-absent admission、assembled holdout、Retention 与 outcome 归因。
- 尚未证明自动晋升、长期保持率、负迁移率、误晋升率或 Hermes 上位替代。
- 因此本增量不满足发布 tag 或“自我进化完成”声明。
