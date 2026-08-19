# V4-9 内部 Skill Candidate 边界重建证据

> 声明等级：`implemented`，不是 `verified/released`。本文证明活动源码已移除运行时能力获取与研究 Candidate 契约，并把 Candidate ingress、持久化、Admission、Lineage、Shadow 和 Web 收敛到内部 Skill Opportunity；它不证明完整自我进化或 Hermes 上位。

## 已实现的唯一 Candidate 数据流

```text
DSH-owned Goal experience
  → Host-verified Capability Gap
  → Workspace-scoped Skill Opportunity
  → bounded model author
  → canonical text-only whole-Skill bundle
  → SkillCandidateRepository quarantine
  → deterministic Admission
  → independent assembled Shadow
  → existing Review / Generation gates for future Sessions
```

`SkillCandidateRepository.quarantine()` 是唯一 ingress。输入必须绑定一个内部 Opportunity、至少两条不重复 Gap、至少两个 Goal、Workspace、author policy、model identity hash 和 input digest。Host 自己组装 canonical `tar.gz`，只允许根 `SKILL.md` 与被引用的一层 `references/*.md`；路径、顺序、mode、tar metadata、gzip、artifact hash 和 tree hash 均由 Host 固定。Candidate 初始状态固定为 `inactive/quarantined/unevaluated/never`，仓储没有 search、download、import、install、activate、evaluate 或 release interface。

Candidate 使用新的 `evoforge_skill_candidates` Storage Domain。Store 不再继承观测队列的按数量自动淘汰；内容寻址 Candidate 在明确治理决策前全部保留，避免尚未评测的 Candidate 和谱系证据静默消失。当前 reader 只接受：

- `opportunity.kind = internal-experience-v1`；
- `authorship.kind = bounded-model-authoring-v1`；
- `version.kind = experience-authored-bundle-v1`；
- canonical text bundle、无脚本、未知外部效果和强制 effect review。

旧 local Git、Agent Skills index/archive、trusted source、match、discovery attempt、runtime research、research Holdout/revision 和 v2/v3 Candidate shape 不读取、不迁移，也没有兼容入口。

## 治理边界

- `SkillCandidateAdmission` 只对 exact Workspace+Skill 的固定 baseline/Case Pack hash 运行零模型确定性 paired Trial；assembled evaluator、治理根重叠、输入漂移、非指令文件和可执行内容 fail closed；结果没有发布权。
- `SkillCandidateLineage` 只绑定 Opportunity、Candidate、author policy、content/tree 和 exact admission，不包含外部来源、研究语料、Skill body、host path 或 hidden case。
- `SkillCandidateShadowLauncher` 必须使用与 Admission 不同的 exact assembled holdout Case Pack，重新核对 durable admission result、Candidate tree 和隔离根，再进入既有 sealed Shadow/Review。
- Shadow journal 使用 `skillCandidateLineage`；旧 `discoveredSkillLineage` 不兼容读取。Candidate 晋升仍只能通过既有独立 Review/Generation 门，并只影响未来 Session。
- DSH Web 只投影内部 Opportunity、author policy、Candidate version/content/tree、Admission 和 Lineage；不显示来源市场、获取尝试或 runtime research 状态，也不提供安装/激活动作。

## 删除证据

活动源码直接删除了 `trusted-skill-discovery.ts`、`skill-research.ts`、`research-skill-holdout.ts`、`research-skill-revision.ts` 及对应测试；Agent Skills index/archive discovery 测试和 zip 获取依赖也已删除。whole-Skill codec 被收敛为 Host-owned canonical text bundle；历史证据页保留但明确标记为已撤销方案。

## 自动化证据

在固定 DSH 源码 `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）上，本增量执行：

- `dsh-evolve` typecheck 通过；全量 Vitest 为 55 files、247 tests 通过、2 tests skipped、0 failed；
- `dsh-evolve-web` typecheck 通过；Vitest 为 2 files、25 tests 通过、0 failed；
- 根级 `pnpm typecheck` 与 `pnpm build` 均覆盖 11 个用户包并通过；`pnpm check:docs` 通过；
- `dsh-doctor/test/suite-native-plugin-contract.test.ts` 为 1 file、22 tests 通过，证明十一包继续满足原生插件静态合同；
- `dsh-software-delivery/test/clean-profile-suite.e2e.test.ts` 为 1 file、1 test 通过（26.86 秒）：十一份最终 tarball 在全新 profile 完成 add、dump、boot，使用真实 DSH Session/Goal/Storage，随后 dispose、remove、再次启动并从原生存储 readback；
- 使用源码重新构建 `evaluator-browser` acceptance bundle，并由真实浏览器打开 Skills 控制面：`Self-discovered Skill opportunities`、内部 author、Candidate、Admission 和 exact lineage 均有非零布局；Candidate 显示 `Whole package · 2 files · 640 bytes · references`；`Agent Skills`、`ClawHub`、`Marketplace`、`Local Git`、`Distribution` 与旧 research 文案均不存在；点击 `Refresh` 后权威状态保持可用，页面 diagnostics 为 `[]`，console warn/error 为 0。

上述结果只证明本增量和既有十一包安装路径，没有把源码 acceptance bundle 冒充最终 tarball 的 DSH Web 浏览器验收，也没有替代真实 provider、真实飞书或 Hermes paired 门禁。

## 未完成

- Opportunity v2 已保守关联 correction reference 和 compact delivery outcome context，但 fixed `causalClaim: none`；exact invocation、rework、cost、reuse、Retention、negative transfer 和 rollback 归因仍未完成；
- 内部 Candidate 的真实 provider、未见任务、Retention、反事实 canary、长期误晋升和精确回滚整链证据未完成；
- 本次源码构建的 Web 投影已通过真实浏览器复验；最终 tarball 安装进 clean-profile 后的同路径浏览器复验仍未完成；
- exact 飞书消息闭环与同模型、同权限、同预算 Hermes paired benchmark 未完成。

因此本证据不能支持“自我进化完成”、发布 tag 或“全面上位 Hermes”的声明。
