# V4.52：尝试间新增工作的严格差值上下文

> 日期：2026-08-24
> 实现提交：`da8616eca2f5faf0af0e4405bc4a738b6e38e768`
> 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
> 结论：本纵切已验证；它证明相邻 Outcome 的新增工作可以严格测量、持久恢复和可视化，不证明 Skill 导致返工或改善。

## 验证对象

V4.52 在 V4.51 的 `ExactSkillOutcomeContextProjection` 内增加 `Between-Attempt Work Context`。它只处理同一
Workspace、Session、Goal、Generation 且晚于 exact Skill use 的 durable Delivery Outcome。相邻 attempt 必须
满足：`observedAt` 严格有序、两侧 DSH Goal metrics 同源且 goal id 精确一致、后一 `throughEventSeq` 前进、所有
累计 turns、steps、token、cache、latency 和 active-wall counters 单调。只有全部条件成立才做后一快照减前一快照。

并列时间使整个 Goal 的 attempt 顺序标记为 ambiguous；缺少任一快照、Goal 不一致、event seq 不前进或任一累计
计数回退时，只保留 ordered transition 并记为 unmeasured。差值不伪装成原始 Goal metrics，也不进入 Candidate、
评测、晋升或回滚资格。Host、Control、固定 Typert Remote、`/evolve status` 和 DSH Web 共用同一个权威 summary。

## 自动化门禁

- 投影测试覆盖严格相邻差值、`10−4=6` 而非总量相加、缺快照、计数/序号回退、latest 时间并列、全量 rollup 与
  20 行有界明细。
- Command、Control、Remote 和 Web 测试覆盖 ordered/measured/unmeasured/ambiguous、最新 Outcome 与尝试间
  token/cache/latency 分开展示，以及固定无因果、无 improvement claim、无 release authority。
- 浏览器 fixture 必须从真实原生 Skill Tool 和 source-linked `complete_delivery` Session call/result 形成证据；
  不允许直接写 `evoforge_skill_uses` 或 `evoforge_delivery_outcomes`。
- 根级 `pnpm check` 通过：11 个插件共 538 tests passed、3 skipped；文档、类型、测试、构建和 Typert freshness
  全部通过。

## 最终包与 clean-profile 安装

从提交 `da8616e` 的最终构建产物打包：

- `dsh-evolve-0.1.0-alpha.1.tgz`：SHA-256
  `72737239bf042fef546165edc6f07f80a088d9daf6da6d97a00299a35499ec50`
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：SHA-256
  `a695d514aa8c7ad7de2e9c192a167360dc0afbdfd2c45587af1a00a034263e4b`

两个 tarball 经 DSH 官方 `plugin --profile web add` 安装到全新
`/private/tmp/dsh-evoforge-v452-final.2WN54S/browser-dsh-home`。安装后 profile dump 同时包含 `dsh-evolve` 与
`dsh-evolve-web`。test-only overlay 只建立真实 DSH Workspace、Agent、Session、Goal 和确定性 Session 事件，
出货 Bundle 未被修改。

## 真实浏览器结果

真实 DSH Web 首次打开“高级 → 精确 Skill 结果上下文”显示：

- exact reuse：2 uses、2 Goals、1 exact version、1 cross-Goal version；
- Outcome context：2/2 Goal contexts observed、3 delivery attempts、1 repeated Goal、1 recovered Goal、0 ambiguous；
- latest durable results：2 passed、0 failed、0 unknown；
- latest metrics：2 measured、0 unmeasured，43 uncached input、11 output、63 cache-read、7 cache-write，LLM 8 ms、
  tool 50 ms、TTFT 4 ms、active wall 298 ms；
- between-attempt work：1 ordered transition、1 measured、0 unmeasured、0 ambiguous Goal orders；
- between-attempt delta：0 uncached input、0 output、0 cache-read、0 cache-write，LLM 0 ms、tool 10 ms、TTFT 0 ms、
  active wall 30 ms、0 attributed turns、0 closed steps。

差值为零 token/cache 而 tool/active-wall 增加，证明页面展示的是两个累计快照的差，而不是把两次 attempt 总量相加。
手动“刷新”后上述数值不变。整页 reload、同 profile/同端口冷启动后仍为 3 次 attempt 和 1 次 transition，没有
重复播种；冷恢复页面 console error 为 0。

随后完全停止 Host 并在仍打开的 Web 中点击“刷新”：页面明确显示 `Failed to fetch`，同时保留最后一次可信的
transition 和差值。用相同 profile、相同端口再次冷启动后，同一页面刷新清除错误并恢复完全相同的数据。再次整页
reload 后证据仍一致，最终稳定页面 console error 为 0。

## 官方卸载

停止 Host 后执行 DSH 官方：

```sh
dsh plugin --profile web remove dsh-evolve-web dsh-evolve
```

卸载结果：profile dependencies 为 `{}`；`node_modules/dsh-evolve` 与 `node_modules/dsh-evolve-web` 均不存在；
`--dump-default-config` 不含 `dsh-evolve|evoforge`。不带 test overlay 的原生 DSH Web 在同端口成功启动，页面
“演化”按钮计数为 0，console error 为 0。

## 边界与剩余门禁

- 本证据来自确定性的 test-owned Session 事件，但经过真实 DSH Skill Tool、Session durability、StorageDomain、
  Host、Remote 和浏览器路径；它不是两套真实 provider 的长期用户任务。
- `Between-Attempt Work Context` 只说明两次 attempt 之间新增了多少可测工作，不等于返工成本、效率变化或 Skill
  因果效果，不能支持自动晋升或“Hermes 上位替代完成”声明。
- 真实飞书 exact route、两套独立真实 provider、长期 Outcome/负迁移/遗忘，以及同任务同模型同权限同预算的
  Hermes paired benchmark 仍阻止 tag 和整体完成声明。
