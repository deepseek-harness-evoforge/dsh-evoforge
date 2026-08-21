# V4.51：exact Skill 与后续 Delivery Outcome 的非因果上下文

> 日期：2026-08-21
> 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
> 结论：本纵切已验证；它证明后续持久 Outcome、重复尝试、恢复和测量可被可靠展示，不证明 Skill 导致结果改善。

## 验证对象

`dsh-evolve` 增加只读 `ExactSkillOutcomeContextProjection`，连接两个已有且独立持久的 DSH 事实：V4.50 的
Exact Skill Use 与 source-linked `complete_delivery` Delivery Outcome。只有相同 Workspace、Session、Goal、
Generation，且 Outcome 不早于该 exact use、revision 不倒退时才关联。

投影只展示跨至少两个不同 Goal 的 exact Skill name/content hash/Generation。它保留每个 Goal 的全部交付尝试，
唯一最新结果为 passed 且此前存在非 passed 时显示“后续恢复”；同一最新时间出现多个结果则 abstain，不选择有利
状态，也不汇总该 Goal 的最新指标。Workspace/selected/baseline 汇总覆盖全部版本，Web 明细最多 20 行。

Command、固定 Typert Remote 与 DSH Web 共用 Host 权威 summary。输出不含 Session/Goal id，固定无因果、无
improvement claim、无 release authority，也不参与 Candidate、晋升或回滚。

## 自动化门禁

- 单元测试覆盖：晚于使用的同 Session/Goal/Generation 关联；使用前、旧 revision、其他 Session/Generation 拒绝；
  多次尝试与恢复；无 Outcome；latest timestamp 冲突时拒绝状态/恢复/指标；21 个版本时全量 rollup 仍完整而明细
  保持 20 行上限。
- Control/Command 测试覆盖 all/selected/baseline、不可变拷贝、有界明细和明确的非因果文案。
- Web 测试覆盖中文/英文 rollup、attempt/recovered/ambiguous、最新状态、token/cache/latency 与无发布权提示。
- `dsh-evolve`：67 files passed、1 skipped；290 tests passed、1 skipped。`dsh-evolve-web`：2 files、24 tests
  passed。根级 `pnpm check` 通过，11 个包累计 537 tests passed、3 skipped；文档、类型、测试、构建和 Typert
  freshness 共同通过。

## 最终包与真实浏览器

最终 `dsh-evolve` 与 `dsh-evolve-web` tarball 通过 DSH 官方
`plugin --profile web add` 安装进全新隔离 profile。test-only fixture 在同一 Workspace 建立两个原生 DSH
Agent/Session/Goal，以真实原生 Skill Tool 调用同一个 `reuse-dsh-evidence` exact 内容；随后只向原生 Session
追加合法、source-linked 的确定性 `complete_delivery` call/result 并执行官方 flush，不读写
`evoforge_skill_uses` 或 `evoforge_delivery_outcomes`。

- `dsh-evolve-0.1.0-alpha.1.tgz`：SHA-256
  `0227e3621dd52103a8ece8a1a902aa63e5fc8a0f41bb5452592d8803f07b8eda`
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：SHA-256
  `d5751283fecbc4ccce7cd2b42ab65de2dbbd1323ae1d959ba43daf77cd3ae9da`

生产 Skill Use/Outcome monitor、StorageDomain、Control、Remote 与 Web 最终显示：

- exact reuse：2 uses、2 Goals、1 exact version、1 cross-Goal version；
- Outcome context：2/2 Goal contexts observed、3 delivery attempts、1 repeated Goal、1 recovered Goal、0 ambiguous；
- latest durable results：2 passed、0 failed、0 unknown；
- latest metrics：2 measured、0 unmeasured，43 uncached input、11 output、63 cache-read、7 cache-write，并显示
  DSH 投影的 LLM/tool/TTFT/active wall time；
- 明示同 Session/Goal/Generation 且在使用之后只构成时间上下文，不证明成功、返工、恢复或提升由 Skill 导致，
  也没有发布权。

人工刷新和整页 reload 后数据不变。Host 完全停止时，“刷新”明确报告 `Failed to fetch` 且保留最后成功证据；
同 profile/同端口冷启动后，原生 Session 与两个 StorageDomain 幂等恢复为相同 3 次尝试，没有重复计数。

最终使用官方 `plugin --profile web remove dsh-evolve-web dsh-evolve` 卸载；profile dependencies 为空，两个
`node_modules` 入口消失，默认 dump 不含 EvoForge。无 test overlay 的原生 DSH Web 可再次启动，没有“演化”
入口，新页面 console error 为 0。

## 边界与剩余阻塞

- Skill 调用经过真实 DSH Skill Tool；三份交付结果是 test-owned、确定性的合法 Session 证据，用于验证生产投影，
  不是两套真实 provider 的长期用户结果，也不是 Skill 效果实验。
- 本纵切没有给出成功率、返工降低、负迁移、遗忘、Retention、误晋升或误回滚结论，未增加任何自动晋升权限。
- 真实飞书 exact route、两套独立真实 provider、长期 Outcome 和 Hermes 同条件 paired benchmark 仍阻止 tag 和
  “Hermes 上位替代完成”声明。
