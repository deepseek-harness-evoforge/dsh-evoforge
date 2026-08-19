# V4-7：独立 Research Holdout 纵切证据

> 历史撤销证据：本页记录已删除的运行时 research Candidate/Holdout 方案，不代表当前产品能力。当前独立治理从内部 Candidate 进入，见 [V4-9](v4-9-internal-skill-candidate-boundary.zh.md)。

日期：2026-08-18

本切片把此前“保留 verification、但尚未消费”的研究语料变成 DSH 原生治理门。设计依据与竞品/前沿审计见
[`v4-7-whole-skill-grounding-audit.zh.md`](../research/v4-7-whole-skill-grounding-audit.zh.md)：作者不能自证，验证必须绑定精确产物，失败归因才能进入后续受限 revision。

## 已实现边界

1. `SlowLoopSkillAuthoring.verificationFor(candidate)` 只接受与私有作者日志完全一致的
   Candidate id、author identity hash、input digest、research digest、cross-Goal cluster 和 target；只返回
   verification，不返回 knowledge、正文路径或日志路径。
2. `ResearchSkillHoldout` 使用不同运行根、不同每日预算和独立 evaluator identity。默认 evaluator route 使用
   `DSH_EVOLVE_HOLDOUT_MODEL_*`，并显式拒绝与当前 author route/model 对应的身份。
3. Candidate 只以 `0600` 临时文件只读物化，接受 instruction-only 文本 bundle，绝不执行 Candidate 内容；临时副本读取后删除，权威制品仍是私有 Storage 内的内容寻址 archive。
4. evaluator 只收到完整 Candidate 文本和扣留 evidence 的 `{contentDigest,title?,excerpt,truncated}`，不收到
   knowledge、来源 URL、发布能力或总判决字段。它必须为每个精确 digest 返回一个
   `satisfied | violated | unresolved` finding。
5. Host 校验 finding 的一一覆盖关系并自行推导：全部 satisfied 才是 `pass`；任一 violated 为 `fail`；否则为
   `inconclusive`。重复、未知、漏项、超长归因或非法结构均为 incomplete。
6. native Jobs scheduler 只在持久化结果为 `pass` 时回调既有 deterministic admission。精确
   Holdout result 会先被缩减为冻结的 identity-only receipt，findings、evaluator identity、attribution 和成本
   都不进入 admission。result id 现在参与 admission 内容寻址身份、持久 state/result 和 Web 投影；缺失、
   fail、错 Candidate/research/tree 或 v3 自己的旧失败 receipt 都在物化前 fail closed。其余状态
   保持 quarantined；模块没有安装、激活、发布或晋升接口。
7. 付费调用前持久化 `evaluation-pending`；未观察到响应的异常或重启成为 `uncertain`，禁止盲重试。调用前取消、预算延后、本地完整性失败分别持久化，且不会伪报模型调用。
8. 启动拓扑强制每个同时配置 authoring 与 admission 的 Workspace+Skill 都有精确 Holdout，防止 research-v2
   Candidate 绕过验证；Holdout 根不得与 authoring、admission、Shadow、supervisor 或其他治理根重叠。
9. admission → assembled Shadow 交接新增宿主派生的 identity-only `DiscoveredSkillLineage`。它把精确
   Candidate/version/source/content/tree、admission id 和通过 Holdout id 纳入 Shadow run identity；v3 同时绑定
   research digest、父 Candidate/tree 和先前失败 Holdout id。journal、terminal report、resume 与 Review Inbox
   逐层比对同一对象；额外私有字段、缺失 ancestry、错 Workspace/Skill/tree 或 report 篡改均 fail closed。
10. 对 sha256 tree 身份的外部/研究包，admission 在 Trial 前重新散列 materialized directory；它与 Holdout
    绑定的 Candidate tree 不一致时返回 `incomplete`，不会把不同内容标成 qualified。
11. Publisher 在 preview/publish 前再次严格解析 Review lineage，并核对 Workspace、Skill 与 sealed
    Candidate tree；错 tree 会在创建 Git ref 或发布 Generation 前 fail closed。通过后 lineage 写入 immutable
    Skill Generation artifact，并参与 Generation 内容寻址，因此同一 Git Skill tree 的有/无 lineage 是不同
    Generation identity。Storage 重启恢复后 lineage 及嵌套 research 仍被冻结。

## DSH Web 投影

Web 的 Skills 页新增 `Independent research Holdout / 独立研究 Holdout`：展示状态、原因、目标、research →
Candidate tree → evaluator identity 摘要、模型成本和逐锚 assessment。投影刻意删除 excerpt、source URL、模型
route、evaluator attribution、Skill 正文和私有路径，也没有 Install/Activate 操作。
确定性 admission 卡片同时显示截断的 `Bound research Holdout pass` id，让用户能区分
“Holdout 曾经通过”和“这一次 admission 已绑定哪个 pass”。
同一 Host 控制面现在还把 identity-only lineage 投影到待审核 Review、已发布待启用 Generation 和活动
Generation；待启用状态从真实 Generation artifact 读取，并要求 artifact lineage tree 与 Review tree 一致。
Skills 页用一条小型时间线显示 source、父 Candidate/tree、失败 Holdout、v3 Candidate/tree、admission target
与通过 Holdout。所有 content id 都截断显示，候选卡明确标记其自身没有发布权限；没有新增 Install、Activate
或绕过现有 Promote 的动作。

## 验证

- TDD 红灯先证明 Holdout 模块不存在、控制面尚未投影结果；实现后转绿。
- 当前全包门禁：`dsh-evolve` 为 302 passed / 2 skipped，`dsh-evolve-web` 为 25/25；根级
  `pnpm check` 的 docs、全部 Workspace typecheck/tests/build 均通过。
- `research-skill-holdout.test.ts` 覆盖精确逐锚通过、宿主派生 fail/inconclusive、非法覆盖失败关闭、作者/评估者身份冲突、预算延后恢复、不确定调用不盲重试、可执行内容拒绝、根隔离和仅 pass 下传；`discovered-skill-admission.test.ts` 额外覆盖 receipt 缺失/失败/错 Candidate 拒绝、内容寻址绑定、materialized tree 漂移及 Shadow 前持久复验。
- `discovered-skill-lineage.test.ts`、`discovered-skill-shadow.test.ts`、`exact-candidate-shadow.test.ts` 与
  `review-inbox.test.ts` 覆盖最小字段白名单、私有字段拒绝、run-id/journal/report/resume 绑定、错 tree 拒绝和
  Review report 篡改隔离；`candidate-publisher.test.ts` 与 `generation-store.e2e.test.ts` 继续证明发布前精确核对、
  Generation identity 绑定、嵌套冻结和重启恢复。
- `slow-loop-skill-authoring.test.ts` 覆盖 verification-only 精确交接及 knowledge 隔离。
- `evolution-control-plane.test.ts` 证明私有 evaluator attribution 不进入浏览器快照。
- `dsh-evolve-web` 客户端测试证明摘要链和治理状态可见且不存在安装/激活按钮。
- 真实应用内 Browser 在 `?semantic` 产品 fixture 上验证：Holdout section 为 `526 × 259`，控制面板为
  `560 × 632`，内部 `scrollWidth === clientWidth === 558`；Install/Activate 按钮为 0；holdout URL、
  evaluator attribution、Skill 正文和 model route 泄漏均为 false。视觉检查确认三段 digest 血缘自然换行，
  逐锚 assessment 与“无发布权限”状态在窄面板内清晰可读。
- 新增 pass receipt 后再次用真实应用内 Browser 验收：admission section 为 `526 × 225`，
  receipt 行为 `504 × 13`，控制面板仍为 `560 × 632` 且 `scrollWidth === clientWidth === 558`；
  Install/Activate 按钮为 0，verification URL、私有 attribution、Skill 正文和 provider route 泄漏
  均为 false，browser diagnostics 为 `[]`。目视确认 receipt 位于 target 和 baseline/candidate 结果之间，
  无遮挡或横向溢出。
- Generation lineage UI 新增后第三次用真实应用内 Browser 在 `?semantic` 验收：活动 artifact 的 lineage
  卡片宽 `504`、面板宽 `560`，两者均无横向溢出；完整 v3 时间线与上下游 Holdout/admission id 一致。
  页面刷新后 `Exact evolution lineage` 仍精确出现一次，完整 64 位 Candidate id 与 `/private/evolution` 均为
  0，browser diagnostics 和 warn/error console 均为空。另在 `?review&stale` 触发过期 Review，Web 显示
  Host `not_found` 的权威刷新提示且 diagnostics 仍为空，证明失败状态没有被本地 UI 吞掉或伪装成成功。

后续的一次性修订闭环已经落在
[`v4-7-one-shot-research-revision.zh.md`](v4-7-one-shot-research-revision.zh.md)：原始 v2 的
fail/inconclusive 可在脱敏交接后生成一次 v3，v3 重新进入本 Holdout 且不能递归修订。真实 provider、真实飞书
exact route、Hermes paired 与长期 outcome 仍待外部条件满足，因此仍不打 tag。
