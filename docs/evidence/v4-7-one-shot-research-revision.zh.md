# V4-7：一次性 Research Skill 修订纵切证据

> 历史撤销证据：本页记录已删除的运行时 research revision 方案，不代表当前产品能力。当前慢环不读取外部研究或旧 revision shape，见 [V4-9](v4-9-internal-skill-candidate-boundary.zh.md)。

日期：2026-08-18

本切片实现独立 Holdout 失败后的唯一受控反馈边，不把 Hermes/OpenClaw 的自改循环照搬进 DSH。设计原则来自
[`v4-7-whole-skill-grounding-audit.zh.md`](../research/v4-7-whole-skill-grounding-audit.zh.md)：独立评估、精确产物
血缘、整包变更和有界迭代必须同时成立。

## 已实现边界

1. `ResearchSkillHoldout.revisionInput` 只接受原始 `slow-loop-research-bundle-v2` 和磁盘中完全一致的 durable
   `fail/inconclusive`；宿主重新计算 Candidate/research/tree/evaluator/target 绑定的 Holdout id，并逐字段比对结果。
2. 交接只包含 Holdout id、research digest、父 Candidate/tree，以及失败或未决锚的
   `{anchorDigest, assessment, attribution}`。satisfied 锚、verification excerpt/title/URL、knowledge、作者日志路径和
   evaluator route 均不进入 reviser。
3. `ResearchSkillRevision` 拥有独立静态 target、私有 run root、UTC 日预算和 native Jobs 调度。父 whole-Skill
   只在宿主临时目录中物化、读取后删除，从未执行。
4. reviser 只能调用一次并返回完整 `SKILL.md + references/*.md` replacement。宿主重新执行路径、UTF-8、文件数、
   字节、引用、Skill name 和 archive 组装校验；tree 未变化或响应非法时 fail closed。
5. v3 Candidate 的 model/input/research/artifact/tree、parent Candidate/tree 和 Holdout id 都由宿主绑定；返回 Candidate
   还要逐项复核包摘要、无脚本、未激活、未验证、未执行状态，之后才记为 `candidate-ready`。
6. discovery 的既有 Candidate callback 自动把 v3 送回独立 Holdout。revision scheduler 只匹配原始 v2，因此 v3
   再次 fail/inconclusive 只会保持 quarantined，不会生成 v4 或形成死循环。
7. 付费调用前先持久化 `revision-pending`。网络结果未知、取消发生在 dispatch 后或进程重启都记为 `uncertain`，
   禁止盲重试；预算耗尽只允许到达 durable `retryAt` 后再尝试。每个 Workspace+Skill 维持 single-flight。
8. 默认 route 优先使用 `DSH_EVOLVE_REVISION_MODEL_BASE_URL/NAME/API_KEY`，缺省时复用 authoring route；这不削弱
   Holdout evaluator 的独立身份约束。revision 模块没有 install、activate、execute、publish 或 release 接口。
9. v3 通过 Holdout 和 deterministic admission 后，宿主生成只含公开内容身份的
   `DiscoveredSkillLineage`，把 v3 Candidate/tree、parent Candidate/tree、触发修订的失败 Holdout、重新验证的
   通过 Holdout 与 admission id 一起绑定进 assembled Shadow run id、journal、report 和 Review evidence。
   ancestry 缺失、两次 Holdout id 相同、materialized tree 漂移、resume 输入变化或 report 血缘篡改均失败关闭。

## DSH Web 投影

Skills 页新增 `One-shot research revision / 一次性研究修订`，展示 target、状态、原因、research → parent tree →
Holdout → reviser identity 摘要、脱敏 input digest、v3 Candidate id 和模型成本。控制面刻意不投影 findings attribution、
验证原文/URL、Skill 正文、原始模型身份或私有路径，也没有 Install/Activate 按钮。

## 自动验证

- `research-skill-holdout.test.ts`：durable 失败结果的精确重验证和脱敏交接。
- `research-skill-revision.test.ts`：whole-Skill 成功修订、v3 非递归、单独预算、no-blind-retry、no-op 拒绝、根隔离及
  native Jobs 同 Skill 串行；额外组合测试由真实 `TrustedSkillDiscovery` quarantine/materialize 生成 v2/v3，
  证明调度顺序严格为 `v2 Holdout fail → one-shot revision → v3 Holdout pass → admission`，
  admission 只收到 v3 与那个精确 pass receipt，v3 的 pass 不会再触发 revision。
- `discovered-skill-lineage.test.ts`、`exact-candidate-shadow.test.ts` 与 `review-inbox.test.ts`：验证一次修订 ancestry
  的字段白名单、run identity 持久化、resume 精确匹配、report/Review 一致性和篡改隔离；不保存 reviser route、
  model/input/artifact digest、finding attribution、Skill body 或私有路径。
- `evolution-control-plane.test.ts`：revision run 的只读摘要投影和私有字段隔离。
- `dsh-evolve-web` 客户端测试：revision lineage、成本、治理提示可见，安装/激活操作不存在。
- 真实应用内 Browser 在 `?semantic` 产品 fixture 上验证：revision section 为 `526 × 280`，控制对话框为
  `560 × 632`，`clientWidth === scrollWidth === 558`；Install/Activate 按钮为 0；verification URL、私有
  attribution、Skill 正文和 reviser route 泄漏均为 false。视觉检查确认四段 lineage 在窄栏自然换行，成本、
  v3 回 Holdout 和“不可递归/无发布权”提示清晰可读。

本切片仍不是发布完成声明。确定性组合测试已覆盖到 admission，且 exact lineage 已绑定 Shadow/Review；但真实 provider 的
v2 fail → v3 revision → Holdout pass → admission → Shadow → Retention
paired run、最终 Generation/Web 血缘、真实飞书消息、长期 outcome 和真实 Hermes 对照仍待外部条件满足；完成前不打 tag。
