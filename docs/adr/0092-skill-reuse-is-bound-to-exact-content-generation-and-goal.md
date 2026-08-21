# ADR-0092：Skill 复用只按 exact 内容、Generation 与 Goal 计数

- 状态：accepted
- 日期：2026-08-21
- 关联：[ADR-0064](0064-corrections-require-exact-durable-skill-invocation.md)、[ADR-0065](0065-existing-skill-improvement-requires-exact-invocation-content.md)、[ADR-0048](0048-self-discovery-learns-from-dsh-experience.md)
- 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 背景

“复用”如果只按 Skill 名、Tool 调用次数或模型自述统计，会把同一 Goal retry、同名内容漂移、不同
Generation 和未持久化事件混在一起。这样的数字既不能描述真实跨任务需求，也很容易被误用为改进或晋升证据。
DSH 已经拥有 Session、Goal、Skill Tool、Generation pin 和持久化边界，EvoForge 不需要另建事件源。

## 决策

1. `Exact Skill Use` 只在原生 Session 中存在成功、source-linked 的 `skill` 调用结果，Host 完成官方
   Session flush，并能折叠出一个 active 原生 Goal 后记录。用户显式调用与模型 Tool 调用分开计数；失败、歧义、
   无 Goal 和 durability 失败全部 abstain。
2. identity 固定为 Workspace、Skill name、模型实际看到的 invocation content SHA-256、Session-pinned
   Generation、Session 和 invocation seq；记录只保存哈希和有界身份，不复制 Skill 正文。
3. `Cross-Goal Skill Reuse` 只在同一 Workspace 内，对相同 Skill name、content hash 与 Generation 的
   Exact Skill Use 覆盖至少两个不同 Goal id 时成立。同一 Goal 的重复调用不增加 Goal 数；同名不同内容或不同
   Generation 永不合并。原生未选 Generation 是一个明确的 `native` bucket，而不是猜测版本。
4. live 观察先 checkpoint 再投影；Host 冷启动时从已持久化 Session 幂等补记。记录主键绑定 Session 与
   invocation seq；相同来源重放幂等，身份漂移 fail closed。
5. Control/Remote/Web 只投影有界计数、Skill name、内容哈希、Generation、route 和状态，不下发 Session id、
   Goal id、Skill 正文或路径。投影固定 `causalClaim: none`、`releaseAuthority: none`。

## 后果

- Web 可以证明“同一个 exact Skill 版本确实在多个原生 Goal 中被使用”，并跨页面刷新和 Host 重启恢复。
- 该事实可以成为后续内部经验归因的输入，但本身不证明任务成功、正确路由、能力提升、保持率、负迁移或晋升资格。
- 真实跨任务价值仍需把 exact reuse 与 Outcome、返工、成本、Retention 和 paired benchmark 连接；在完成前不得把
  使用次数宣传成自我进化。
