# V4-7：独立 Research Holdout 纵切证据

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

## DSH Web 投影

Web 的 Skills 页新增 `Independent research Holdout / 独立研究 Holdout`：展示状态、原因、目标、research →
Candidate tree → evaluator identity 摘要、模型成本和逐锚 assessment。投影刻意删除 excerpt、source URL、模型
route、evaluator attribution、Skill 正文和私有路径，也没有 Install/Activate 操作。
确定性 admission 卡片同时显示截断的 `Bound research Holdout pass` id，让用户能区分
“Holdout 曾经通过”和“这一次 admission 已绑定哪个 pass”。

## 验证

- TDD 红灯先证明 Holdout 模块不存在、控制面尚未投影结果；实现后转绿。
- `research-skill-holdout.test.ts` 覆盖精确逐锚通过、宿主派生 fail/inconclusive、非法覆盖失败关闭、作者/评估者身份冲突、预算延后恢复、不确定调用不盲重试、可执行内容拒绝、根隔离和仅 pass 下传；`discovered-skill-admission.test.ts` 额外覆盖 receipt 缺失/失败/错 Candidate 拒绝、内容寻址绑定及 Shadow 前持久复验。
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

后续的一次性修订闭环已经落在
[`v4-7-one-shot-research-revision.zh.md`](v4-7-one-shot-research-revision.zh.md)：原始 v2 的
fail/inconclusive 可在脱敏交接后生成一次 v3，v3 重新进入本 Holdout 且不能递归修订。真实 provider、真实飞书
配对和真实 Hermes 对照验证仍待外部条件满足，因此仍不打 tag。
