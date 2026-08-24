# V4.53：精确 Skill 重复最新失败的只读调查

> 日期：2026-08-24
> 实现提交：`e93d3bdaab45db985453e03d04036a950fc6a7de`
> 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
> 结论：本纵切已验证；它证明 DSH 内部持久失败事实可以形成可撤回、可恢复、可视化的 review-only 调查，不证明 Skill 导致失败，也不产生 Candidate 或发布权。

## 验证对象

V4.53 在既有 `ExactSkillOutcomeContextProjection` 上增加 `Exact Skill Failure-Context Investigation`。只有同一
Skill name、invocation-content hash 与 Session-pinned Generation 覆盖至少两个不同 Goal，且其中至少两个 Goal
各自具有唯一最新 `failed` Delivery Outcome，才标记为 `eligible-for-review`。同 Goal retry 只算一个 Goal；后来
唯一 latest 为 passed/recovered 的旧失败不计；missing、unknown、并列冲突与顺序歧义 abstain。

调查复用 durable Skill Use 与 Delivery Outcome reader，不新增 Store、队列、Session、Goal、Agent Runtime 或模型
调用。每条调查固定 `causalClaim: none`、`candidateAuthority: none`、`releaseAuthority: none`，不得直接生成、排序
或评测 Candidate，不得触发晋升、回滚或发布。全量 rollup 不受 20 行明细限制；eligible 行在有界明细中优先显示。

## 自动化门禁

- 投影测试覆盖两个不同 Goal 的唯一 latest failed、旧失败后恢复、latest 并列冲突、同 Goal 不重复计数、全量
  rollup，以及第 21 个 exact 版本 eligible 时仍优先进入 20 行明细。
- Control、固定 Typert Remote、`/evolve status` 与 Web 测试覆盖 rollup、阈值、review-only 声明和无 Candidate/
  release authority。
- 浏览器 fixture 使用两个独立原生 DSH Session/Goal，真实调用原生 `skill` Tool，再写入 source-linked
  `complete_delivery` call/result；不直接写 `evoforge_skill_uses` 或 `evoforge_delivery_outcomes`。
- 根级 `pnpm check` 通过：11 个插件共 540 tests passed、3 skipped；文档、类型、测试、构建和 Typert freshness
  全部通过。

## 最终包与 clean-profile 安装

从实现提交 `e93d3bd` 的最终构建产物打包：

- `dsh-evolve-0.1.0-alpha.1.tgz`：SHA-256
  `2716ebc5465f6fe3d5ab05687251f40c2a86ad5e274e7f6caed5676a2fdfaaf5`
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：SHA-256
  `0b9dc082381e1797fdf9ab26889f060246d9131e2877a3fe7f74d274e8373e0e`

两个 tarball 经 DSH 官方 `plugin --profile web add` 安装到全新
`/private/tmp/dsh-evoforge-v453-final.Sx19HA/browser-dsh-home`。组合 dump 同时包含最终 `dsh-evolve`、
`dsh-evolve-web`、固定 Typert Loader 与 test-only overlay。overlay 只建立原生 DSH Workspace、Agent、Session、
Goal、Skill Tool 和 Session events，未改变出货 Bundle。

验收过程中另用非规范 `/var/folders/...` run root 做过一次负向启动；macOS 将其 realpath 解析为
`/private/var/folders/...`，生产 Admission 的 exact-root 门按设计以 `admission-evidence-invalid` fail closed。最终
验收改用 realpath 等于配置值的 `/private/tmp/...`，没有放宽路径门或延长等待掩盖错误。

## 真实浏览器结果

真实 DSH Web 首次打开“高级 → 精确 Skill 结果上下文”显示：

- exact reuse：4 uses、4 Goals、2 exact versions、2 cross-Goal versions；
- Outcome context：2 exact versions、4/4 Goal contexts observed、0 missing；
- investigation rollup：1 eligible version、2 latest-failed Goal contexts；
- `investigate-dsh-failure-context`：2 attempts、0 repeated、0 recovered、0 ambiguous，latest 为 0 passed/
  2 failed/0 unknown；调查行为“可进入因果审查 · 2/2 个最新失败 Goal · 仅供审查；无 Candidate 权限”；
- `reuse-dsh-evidence`：3 attempts、1 repeated、1 recovered、latest 为 2 passed/0 failed/0 unknown；调查行为
  “最新失败不足 · 0/2”，证明旧失败后恢复不会进入 eligible；
- 页面免责声明明确调查只是复核请求，不证明 Skill 导致成功、失败、返工、恢复或提升，不会自动生成 Candidate，
  也没有发布权。

手动“刷新”和整页 reload 后，rollup 与两条明细完全一致，浏览器 error 级日志为 0。

随后完全停止 Host 并在仍打开的页面点击“刷新”：页面明确显示
`evoforgeEvolution/overview failed: Failed to fetch`，同时保留最后一次可信的 1 个 eligible 调查、2 个最新失败
Goal 和两条 exact 明细。用相同 profile、相同端口冷启动后，同一页面刷新清除错误；仍为 4 uses/4 Goals、
2 exact versions、1 eligible/2 latest-failed，没有重复播种。再次整页 reload 后证据不变，error 级日志仍为 0；
断连期间仅出现 DSH Web runtime 预期的连接重试 warning。

## 官方卸载

停止 Host 后执行 DSH 官方：

```sh
dsh plugin --profile web remove dsh-evolve-web dsh-evolve
```

卸载结果：profile dependencies 为 `{}`；`node_modules/dsh-evolve` 与 `node_modules/dsh-evolve-web` 均不存在；
`--dump-default-config` 中 `dsh-evolve|evoforge` 计数为 0。不带 test overlay 的原生 DSH Web 在同端口成功启动，
页面标题为 `DeepSeek Harness`，“演化”按钮计数为 0，browser error 级日志为 0。

## 边界与剩余门禁

- 本证据来自确定性的 test-owned DSH 事件，但经过真实原生 Skill Tool、Session durability、StorageDomain、Host、
  Typert Remote 和浏览器路径；它不是两套真实 provider 的长期用户任务。
- 重复最新失败只足以开启调查，不能单独归因、生成 Candidate、晋升或回滚。existing-Skill 改进仍需精确纠正
  归因、完整 baseline Bundle、生成前证据密封、独立 Holdout/Retention 和发布门。
- 真实飞书 exact route、两套独立真实 provider、长期 Outcome/负迁移/遗忘，以及同任务、同模型、同权限、
  同预算的 Hermes paired benchmark 仍阻止 tag 和整体完成声明。
