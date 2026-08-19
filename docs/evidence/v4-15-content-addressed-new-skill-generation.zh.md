# V4-15 全新内部 Skill 内容寻址 Generation 证据

> 声明等级：`implemented`，不是 `released`。本文证明一个通过 capability-absent 评测的内部 whole-Skill
> Candidate 可以在没有 Git source、外部仓库、市场或网络获取的情况下成为 inactive Generation，并仅供
> 未来 DSH Session 使用；不证明 Retention、canary、自动晋升或 Hermes 上位替代已完成。

## 修正的断点

旧 Publisher 只能从配置的 Git Skill baseline 创建 commit。缺失 Skill 没有该 baseline，因此
`Opportunity → Candidate → Shadow → Review` 到达终点后无法形成未来 Session 可加载的版本。新路径复用
Candidate Repository 已保存的 canonical whole-Skill 内容，形成 `skill-bundle` Generation artifact：

```text
internal Opportunity + exact lineage
  → canonical whole-Skill Candidate
  → capability-absent admission/Shadow/Review
  → inactive skill-bundle Generation
  → explicit promotion
  → future DSH Sessions only
  → root rollback restores native DSH for later Sessions
```

## 实现与边界

- `CandidatePublisher` 对 capability-absent Review 使用空能力基线生成可审查 new-file diff，不解析虚构
  `SKILL.md`；active Generation 已出现同名 Skill 时拒绝陈旧 absence 证据；
- Publisher 重新组装 canonical archive，要求 archive tree 等于 sealed Candidate tree、archive digest 等于
  admitted lineage content hash；
- `GenerationStore` 持久化 `skill | skill-bundle` discriminated artifact，并在写入前重新验证 canonical
  archive、digest、tree 和 Workspace ownership；
- DSH Skill Provider 将 bundle 物化到内容寻址只读 cache，验证 archive、lineage、frontmatter、缓存文件集
  与每个文件内容，损坏或同 hash 不同 manifest 均 fail closed；
- DSH Web/Command 的 Generation projection 显式区分 Git commit 与 bundle artifact digest；
- 既有 Git Skill 路径保持原有 exact commit/tree 行为，不把外部 Git 变成新 Skill 的前提；
- 自动 clear-win policy 仍只接受一个既有 `SKILL.md` 的 append，新 Skill 全包不会进入该策略。

## 自动化与真实 DSH 证据

- `candidate-publisher.test.ts`：无 Git source 的 new-Skill preview/publish/provider load；lineage digest 错误、
  active 同名冲突、持久 artifact 篡改均在发布或加载前拒绝；
- `generation-store.e2e.test.ts`：真实 DSH StorageDomain 持久化并重启读取 exact bundle，篡改 digest 被拒绝；
- `generation-binder.e2e.test.ts`：真实 DSH Agent/Session/Skill Registry 证明晋升前 Session 保持 native，晋升后
  新 Session加载 bundle，root rollback 后新 Session回到 native，已固定 Session不漂移，重启恢复 exact
  bundle 与 reference 文件；整个测试配置 `sources: []`。

完整检查数字记录在本增量提交对应的 `docs/status.zh.md`，避免把后续测试数量倒灌到本文。

## 未完成边界

当前 sealed canary 对 root `skill-bundle` 明确拒绝，因为其父级是 capability-absent subject 而非 Git
first-parent tree。下一增量必须让 Retention/canary 在 baseline profile 中保持目标 Skill absent、Candidate
profile 使用 exact bundle，并验证非目标 composition、回归和失败恢复。Evaluation Envelope 自主生成、
existing bundle 的后续再进化、真实 provider 长期 outcome、飞书闭环和 Hermes paired benchmark 仍未完成；
不得打 tag或宣布自我进化闭环完成。
