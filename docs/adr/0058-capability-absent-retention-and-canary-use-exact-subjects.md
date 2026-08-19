# ADR-0058：Capability-Absent Retention/Canary 使用 exact subject 与 whole-Skill

## 状态

Accepted，2026-08-19。

## 背景

既有 Retention 假设 baseline 一定含 `SKILL.md`，既有 sealed canary 假设 Candidate 一定有 Git
first-parent。内部经验发现的全新 Skill 恰好不满足这两个前提：它的可信父级是原 Shadow 保存的
`capability-absent` subject，Candidate 是内容寻址 whole-Skill bundle。伪造空 Skill、改用 Git source 或重建
Candidate 都会把“当前能力确实缺失”偷换成预配置能力。

## 决策

Retention 必须同时核对原 Shadow identity、resume inputs、report `parentKind`、Candidate lineage 和 exact tree。
Capability-absent 父目录只能包含与目标 Skill 同名的 `subject.json`；不得包含占位 `SKILL.md`、额外文件或
符号链接。Candidate 必须从原 Shadow 的 exact directory 读取，路径、tree、frontmatter name 和 lineage 均保持
不变。独立 prior Case Pack 使用相同 DSH revision、权限、预算和 assembled evaluator；baseline 与 Candidate
都通过且非目标 composition fingerprint 相等时才记录 `retained`。任何漂移、校准失败或父侧失败都不会被写成
通过，proposer 调用数固定为零。

Sealed canary 对 `skill-bundle` 从 Generation 的 canonical artifact 解析 exact Candidate，从原 Shadow descriptor
解析 exact absent parent，不查 Git、不访问网络。若 Generation 有父级，父级必须属于同一 Workspace 且不能
已经包含目标 Skill。Canary 重放原 sealed Case Pack，记录 `parentKind: capability-absent`；证据不一致进入 review，
不猜测结果。

本决策不扩大自动发布权限。`auto-clear-instruction-v1` 的既有窄 canary/rollback policy 保持不变；人工审批的
全新 Skill 不会被实验性 resident policy 静默自动晋升或回滚。Retention 只产生证据，Promotion 仍通过既有
DSH review/Generation 边界，且只影响未来 Session。

## 后果与边界

- 全新 Skill 可以复用与既有 Skill 相同的 Retention/Canary 深模块，而不建立第二套流程；
- absent parent、Candidate、Case Pack 和非目标 DSH composition 任一漂移均 fail closed；
- root rollback 已能让未来 Session 回到 native DSH，当前 Session仍固定原 Generation；
- 当前只证明执行语义和确定性门，不证明自主生成 Evaluation Envelope、长期误晋升率、真实 provider outcome
  或 Hermes 整体上位替代。
