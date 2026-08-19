# ADR-0057：全新内部 Skill 使用内容寻址 Generation Bundle

内部自我发现产生的是完整、canonical 的 whole-Skill Candidate。它已经绑定 Workspace、Opportunity、
Evaluation Envelope、artifact digest 与 tree hash；但旧 Publisher 仍要求为目标 Skill 预先配置 Git
repository/path，并从一个已有 `SKILL.md` 写不可变 Git commit。对于由完整 catalog miss 形成的
`capability-absent` Opportunity，这个前提不成立：要求 Git baseline 会把真正缺失的能力重新偷换成
预置能力，也会让运行时发布依赖外部仓库。

Capability Generation 的 Skill artifact 因此采用两个显式变体：

- `skill`：既有、明确配置的 Git Skill，继续固定 exact commit/tree；
- `skill-bundle`：内部 whole-Skill Candidate 的 canonical tar.gz，固定 artifact digest、tree hash、base64
  content 与完整 Candidate lineage。

`capability-absent` Review 只能发布第二种 artifact。Publisher 必须确认 active Generation 中不存在同名
Skill，重新组装 Host-owned canonical archive，并同时核对 Candidate tree、lineage content hash、Skill
name 与 Workspace。Generation Store 在持久化前再次解码、canonical 重组并验证 digest/tree/ownership，
不能把调用方提供的 metadata 当成内容证明。

未来 Session 的 DSH Skill Provider 直接从该不可变 bundle 物化只读缓存。每次使用都验证 canonical
base64、archive、digest、tree、lineage、frontmatter name 和缓存 manifest；不调用网络、不查询市场、
不安装外部包，也不需要 Git source。Generation 保持 inactive，只有已有 review/promotion 边界可以切换
未来 Session。当前 Session 继续固定旧 Generation；root Generation 回滚后未来 Session 回到原生 DSH，
已启动 Session仍保持原 bundle。

现有 Git artifact 不迁移或复制成 bundle，它仍是受管既有 Skill 的一种来源。运行时 Candidate storage 与
Generation bundle 都不使用 Git branch。自动晋升的窄策略仍只允许既有 Skill 的单文件 append，因此新
Skill 不会因本 ADR 自动晋升。

本决策只完成全新内部 Skill 的发布、加载、Session 固定和 root rollback。`capability-absent` Retention 与
反事实 canary 尚未获得“无目标 Skill”父级执行语义，当前继续 fail closed；Evaluation Envelope 自主生成、
真实长期 provider outcome、负迁移和 Hermes paired benchmark 也仍是发布门禁。
