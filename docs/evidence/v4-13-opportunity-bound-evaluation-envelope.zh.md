# V4-13 Opportunity-bound Skill Evaluation Envelope 证据

> 声明等级：`implemented`，不是 `verified/released`。本文证明内部 Candidate 的评测入口不再由配置预选
> Skill、baseline 或 Case Pack，并证明一个治理面 Envelope 能贯穿 deterministic admission 与 independent
> assembled holdout。本文不证明治理包已自主生成、真实 provider 改善、Retention 或 Hermes 上位。

## 用户可观察不变量

用户只提交自然语言 Goal。DSH 内部 Gap 经过跨 Goal 证据形成 Skill Opportunity，再生成 inactive whole-Skill
Candidate。部署配置只能为 Workspace 授权治理根和运行根，不能告诉系统“要进化哪个 Skill”。没有当前
Opportunity 对应的合格治理包时系统 abstain，不回退到 operator target、外部搜索、Candidate 自评或一次成功。

```text
DSH internal Goal evidence
  → current Skill Opportunity
  → quarantined Candidate
  → governanceRoot/envelopes/<opportunity-id>
      ├─ exact baseline
      ├─ deterministic admission Case Pack
      └─ independent assembled holdout Case Pack
  → qualified-for-shadow only
  → same Envelope identity in Lineage and Shadow handoff
```

## 当前实现

- `SkillEvaluationEnvelopeResolver` 的 policy 只有 `id/workspaceId/governanceRoot/runRoot`；
- 每次解析都重新读取 Host 当前 Opportunity，并核对 Workspace、Skill、Gap 集合和 Goal 数；
- strict manifest 和三棵输入目录按 exact real path、hash、大小与隔离边界校验；
- admission/holdout hash 相同、内容漂移、manifest symlink、目录别名或根重叠均拒绝；
- `SkillCandidateAdmission` 只按 Workspace policy 调度，缺 Envelope 返回 `no-current-evaluation-envelope`；
- durable admission schema 与 Candidate lineage 记录内容寻址 `evaluationEnvelopeId`；
- `SkillCandidateShadowLauncher` 只能从已资格 admission 重新取得同一 Envelope 的 independent assembled holdout；
- DSH Web 把旧的 operator “Evaluation target” 改为只读 “Evaluation Envelope”，不提供选路或安装按钮。

## 自动化证据

测试覆盖：

- 无配置 Skill target 的 Opportunity-bound 正向解析；
- 非当前 Candidate 方向 abstain；
- sealed content drift、admission/holdout 复用与 manifest symlink fail closed；
- real resolver → admission → exact Candidate materialization → assembled holdout launcher 的纵向 handoff；
- durable admission、lineage、Shadow scheduler、Host control projection 与 Web 文案回归。

权威实现与测试位于：

- `packages/dsh-evolve/src/skill-evaluation-envelope.ts`
- `packages/dsh-evolve/src/skill-candidate-admission.ts`
- `packages/dsh-evolve/src/skill-candidate-shadow.ts`
- `packages/dsh-evolve/src/skill-candidate-lineage.ts`
- `packages/dsh-evolve/test/skill-evaluation-envelope.test.ts`
- `packages/dsh-evolve/test/skill-candidate-evaluation-flow.test.ts`

提交前仓库级门禁：

- `pnpm check` 通过；其中 `dsh-evolve` 57 files、269 passed、2 skipped，`dsh-evolve-web` 26/26；
- Cache Contract 全部通过，包括 64 轮 Gap Tool composition、GitHub follow-up、Goal cold resume、
  Software Delivery assembled 请求和飞书 full-channel composition；
- Doctor 十一包原生插件合同 22/22；
- 十一包 clean-profile tarball add/dump/boot、真实路径、dispose/remove/readback 1/1，通过时间 26.07 秒。

## 真实浏览器复验

从当前源码重新构建 `evaluator-browser` acceptance bundle，以 `semantic` 权威投影打开 DSH Web Evolution
control 的 Skills 视图。首次打开和页面 reload 后均满足：

- 完整 64 位 `Evaluation Envelope` 文本恰好 1 项；
- `1 Workspace governance policies` 恰好 1 项；
- 旧 `Evaluation target` 文本为 0；
- install/activate/route 按钮为 0；
- fixture 自记录 diagnostics 为 `[]`，浏览器 console warn/error 为 0。

这是源码 acceptance bundle 的真实浏览器证据；它与上述 clean-profile 生命周期门是两项独立证据，不能
合并冒充“最终 tarball 中真实 provider 评测闭环已完成”。

## 未完成边界

本增量没有从内部 outcome/纠正/失败/回归证据自动选择 baseline、构造未见 Case Pack 或封存 Envelope；目前
只消费治理面已经提供的合格内容。它也没有完成真实 provider、真实 DSH assembled holdout、Retention、
negative transfer、false promotion、精确回滚和同条件 Hermes paired benchmark。因此不能据此宣称完整自我
进化、自动晋升或 Hermes 上位替代已经完成。
