# V4.54：移除活动评测链中的运行时搜索语义

## 结论

`dsh-evolve` 的活动治理与 Shadow 路径不再把 DSH 内部 Goal 证据或 Candidate 执行前的结构门写成
`search`。治理作者只返回一段可审计的内部证据说明 `evidenceRationale`，新 Case Pack 将它写入
`evidence/rationale.md`；Shadow 把路径和 Skill 身份硬门归类为 `structural-admission`。

这次改动没有增加外部 Skill 搜索、下载、导入、安装、市场或“能力获取”入口。历史研究文档仍可描述
被否决的外部方案或通用论文术语，但不再决定活动运行时合同。

## 生产改动

- `SkillEvaluationCaseAuthorResult.searchEvidence` 改为 `evidenceRationale`；真实 provider 返回值校验和
  author prompt 同步收口。
- 治理 Case Pack 的 `search/evidence.md` 与 manifest `search` key 改为
  `evidence/rationale.md` 与 `evidence.rationale`。
- `SkillEvaluationEvidenceVault` 的 author 可见分区明确称为 `authoring subset`。
- Shadow 的 Candidate 执行前拒绝从 `partition: search` 改为
  `partition: structural-admission`。
- P0A 活动契约同步说明 Shadow 无 proposer、治理材料只来自 Candidate 前密封的 DSH Goal 证据。

## 回归合同

自动化测试明确断言：

1. admission Case Pack 没有 `search` key；
2. Case Pack 根目录没有 `search` 目录；
3. 内部证据说明只存在于 `evidence/rationale.md`；
4. Opportunity → Evidence Seal → Governance → Candidate evaluation 的既有完整纵切继续通过。

提交前在当前 `main` 工作树执行：

```text
pnpm --filter dsh-evolve exec vitest run \
  test/skill-evaluation-governance.test.ts \
  test/skill-candidate-evaluation-flow.test.ts
→ 2 files passed；7 tests passed

pnpm --filter dsh-evolve typecheck
→ passed

pnpm --filter dsh-evolve test
→ 67 files passed / 1 skipped；292 tests passed / 1 skipped

pnpm --filter dsh-evolve build
→ passed；Typert 与 Node artifact verification passed
```

Mock/fixture 结果只证明合同与隔离，不会被写成真实 provider 效果证据。

## 未完成与非声明

- 没有发起任何付费 provider 请求；
- 没有取得两套独立真实 provider 的 Candidate/治理/paired Trial 结果；
- 没有完成真实飞书 exact route 或 Hermes paired benchmark；
- 不满足 v0.1 tag 或“上位替代已经完成”的发布门。
