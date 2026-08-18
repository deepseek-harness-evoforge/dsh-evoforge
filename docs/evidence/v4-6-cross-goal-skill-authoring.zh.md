# V4-6 跨 Goal 有界 Skill 生成调度证据

> 历史证据：本页记录过往实现，不代表当前产品主链路或能力声明。运行时外部发现/研究方案已撤销；当前自我发现语义与实现见 [V4-8](v4-8-internal-skill-opportunity-discovery.zh.md)。

> 日期：2026-08-18
> 状态：implemented and locally verified
> 边界：证明 unresolved 同名跨 Goal Gap 可通过 DSH 原生 Jobs、持久预算和崩溃状态机生成一个
> instruction-only `SKILL.md` 隔离 Candidate；不证明官方资料检索、任意市场、archive/多文件组合、
> 真实 provider 质量、迁移/遗忘或 Hermes 上位替代已经完成。

## 可证伪命题

当且仅当以下条件同时成立时，慢环才能触发一次生成：

1. Gap 来自同一 Workspace、同一 exact requested Skill；
2. 至少两个不同原生 Goal id；同一 Goal retry 不计数；
3. trusted discovery 已对 Gap 结算，cluster 任一成员 Gap 都没有 Candidate；
4. 部署者配置唯一 `{ id, workspaceId, skill, runRoot, maxAttemptsPerUtcDay }`；
5. DSH 原生 Jobs 已组合，持久 UTC 日预算还有余额。

缺少任一条件都不会调用 author model。一次 `reconcile` 最多提交一个 `kind: evolution` Job，当前 Session
不等待该 Job，也不改变 Skill catalog 或 Generation。

“已结算”不是读取旧 attempt 猜测：`TrustedSkillDiscovery` 只在本进程按当前配置完成该 Gap 后给出内存证明；
配置来源临时 unavailable 时保持 false。这样重启或新增可信来源时，startup authoring 不会抢在搜索前运行。
authoring run root 与可信 repository、cache、feedback draft、baseline、Case Pack、admission/Shadow/review root
任何父子重叠都会在插件组合阶段拒绝。

## 三平面隔离

- 执行面：当前 Session 继续使用启动时固定的原生 Skill composition；生成器没有 Session/Agent 路由接口。
- 候选面：模型只返回一个有界单文件 `SKILL.md`。Host 重新解析 frontmatter、校验 exact name，记录
  model identity hash、input digest、artifact digest、tree hash 与 cross-Goal Gap 谱系；正文只进入私有
  DSH Storage。Candidate 固定为 `quarantined + inactive + unevaluated + never-executed`。
- 治理面：生成模块只依赖 `quarantineAuthored` seam，没有 install、activate、publisher、promotion 或
  release interface。后续仍必须经过已有 deterministic admission、独立 assembled Shadow 和 review。

## 预算与恢复

- `AutomaticEvolutionBudget.reserve()` 在 author model 之前执行；目标只有静态 exact Workspace+Skill。
- 完整 model evidence payload（target/workspace/skill/cluster/Gap ids/Goal evidence）在预算预留前受 48 KiB
  上限约束，超限时不提交 Job、不消耗预算、不调用模型。
- author request 使用稳定 idempotency key；日预算 journal 在私有 run root 原子写入。
- `prepared → cancelled|budget-deferred|authoring-pending → candidate-ready|incomplete|uncertain` 状态持久化。
- 模型请求发出前收到原生 Job 取消会进入 `cancelled`，model calls 保持 0，同一 run
  禁止自动重试；请求可能已到 provider 后的取消则仍按 `uncertain` 处理，且晚到响应
  不得进入 Candidate 隔离区。
- 已观察到响应但结构/Skill identity 非法时记为 `incomplete`；可能已经付费但没有可靠响应时记为
  `uncertain`，重启后拒绝自动重试。
- 预算耗尽进入 `budget-deferred`，模型调用数保持 0；下一 UTC 日只有新的 reconcile 才可恢复。
- Candidate 已持久化但 run state 尚未提交时，Candidate/Gaps 权威状态会抑制重复生成。

## DSH Web

Skills 页新增“跨 Goal 慢环生成”：只投影 exact target 数、phase、Goal/Gap 数、model call 与 token 计数、
candidate id 和最早重试时间。生成 Candidate 显示 `slow-loop-author` 来源、cross-Goal demand、输入/制品/
tree 摘要和隔离状态；不投影模型 route、run root、Goal 正文、`SKILL.md` 正文或模型响应。

## 自动验证

- `slow-loop-skill-authoring.test.ts`：不同 Goal 门槛、已有 Candidate 抑制、预算先行、预算耗尽、
  完整 input 大小上限、provider 前取消终态、paid-call uncertainty/restart、静态 target 拒绝。
- `trusted-skill-discovery.test.ts`：generated `SKILL.md` identity/provenance、私有 model identity hash、
  `0600` 离线物化、错误 name 拒绝、discovery-settled handoff。
- `evolution-control-plane.test.ts`：Web 权威投影不包含私有路径/正文。
- `evolution-action.client.test.tsx`：慢环 phase/cost/provenance 与“无发布权”可视化，且没有
  install/activate 按钮。

已执行：

- `dsh-evolve` 全套：54 files passed + 1 skipped；266 tests passed + 2 skipped；
- `dsh-evolve-web`：2 files / 25 tests passed；
- `pnpm test:cache-contract`：64-turn Gap Tool stability、GitHub review、Goal continuity、Software
  Delivery、Feishu full-channel composition 与 22 项 suite native-plugin contract 全通过；
- 根级 `pnpm check`：docs、typecheck、test、build 覆盖 11 个用户插件包，退出码 0；
- 真实 in-app Browser 打开实际 `EvolutionAction` fixture 的 Skills 页：慢环 heading 1、
  `candidate-ready` 1、Install buttons 0、Activate buttons 0、原始 Skill 正文 0、私有 model identity 0、
  page diagnostics `[]`；panel 为 560×632，viewport 1280×720，无水平溢出。

## 未完成

- 默认 author adapter 复用已配置的 OpenAI-compatible route，但本证据没有真实 provider 成功输出；
- 没有自动浏览官方文档、论文或开源仓库，也不允许模型伪造检索证据；
- 尚未生成 archive/多文件 Skill，也没有 Skill 组合器；
- 尚未完成真实 holdout、迁移/负迁移、长期 retention 与同条件 Hermes paired benchmark；
- 不满足最终退出门，因此不打 tag，不声明 v0.1 或“上位替代完成”。
