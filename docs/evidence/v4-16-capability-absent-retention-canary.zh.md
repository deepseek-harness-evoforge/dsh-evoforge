# V4-16 Capability-Absent Retention 与 Sealed Canary 证据

> 历史证据：该旧 Retention/canary 编排已在 V4.24 物理删除，exact subject/composition 结论只作为内部 Envelope/Outcome 重建要求。

> 声明等级：`implemented`，不是 `released`。本文证明全新内部 Skill 能以原 Shadow 的 exact
> capability-absent subject 为父级完成独立 Retention 与 sealed canary；不证明自主治理包、自动晋升、真实
> provider 长期效果或 Hermes 上位替代已经完成。

## 修正的断点

```text
completed capability-absent Shadow
  ├─ exact subject.json (target Skill absent)
  ├─ exact internally authored whole-Skill + lineage
  └─ sealed Case Pack / DSH epoch
       ├─ independent prior Case Pack → Retention
       └─ original sealed Case Pack → counterfactual canary
```

Retention 不再读取虚构 baseline `SKILL.md`。它核对 Shadow state/report/baseline kind/parent kind、lineage、
Candidate tree 与 Skill identity，用不同的 prior Case Pack 在真实 DSH 中执行四次 paired Trial；两侧必须保持
相同非目标 composition。Canary 不再要求 Git first-parent：Candidate 从 canonical `skill-bundle` 解出，父侧从
原 Shadow 的 absent descriptor 解出。

## Fail-closed 反例

- absent subject 含额外文件或占位 Skill：Trial 前拒绝；
- Shadow 后 exact Candidate tree 被修改：Trial 前拒绝；
- identity/resume/report 的 baseline kind、parent kind 或 lineage 不一致：拒绝；
- 父 Generation 已含同名目标 Skill或跨 Workspace：拒绝；
- Case Pack、Candidate、parent 或非目标 DSH composition 漂移：结果为 incomplete/review，不晋升。

## 本机证据

- TypeScript source/test typecheck 通过；
- source-integrity 用例 2/2 通过，证明污染 absent subject 与 Candidate 篡改在创建输出前失败；
- 真实 assembled DSH Retention 用例通过：baseline/candidate 均通过独立 prior Case，4 次 Trial，2 次真实模型
  composition call/侧，`proposerCalls=0`，fingerprint 相同；
- sealed canary 2/2 通过：既有 Git Skill 回归路径保持成立；全新 Skill 在无 Git source 情况下以 exact absent
  parent 回放，baseline fail、Candidate pass、4 次 Trial、`proposerCalls=0`；父 Generation 含目标 Skill的反例
  在 Trial 前拒绝；
- Retention SIGKILL 用例仍证明 Trial 被杀后不会自动重启、推进报告或修改 baseline。

- 根级 `pnpm check` 通过；`dsh-evolve` 为 58 files passed、1 skipped，283 tests passed、2 skipped；
- Cache Contract 全部通过，Doctor 十一包原生合同 22/22；
- 十一份最终 tarball 在 clean profile 完成 add、dump、boot、真实 Session/Goal/Tool、dispose、remove、native
  reboot/readback，1/1 通过，用时 27.10 秒。

## 未完成边界

Evaluation Envelope 仍由部署治理目录提供，尚未从内部 Outcome/纠正/回归证据自主形成；新 whole-Skill 仍需
明确人工 review，自动 clear-win policy 没有扩权。Gateway transport/Web 聚合后续已由 V5.1/V5.2 补齐；
真实 provider outcome、长期 Retention/负迁移率、真实飞书闭环和同条件 Hermes paired benchmark 仍是发布
门禁，因此不打 tag。
