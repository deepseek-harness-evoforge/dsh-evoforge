# V4.44 现有 Skill 发布门的 Control、Remote 与 DSH Web

日期：2026-08-21
状态：`implemented`（Host/Control/Typert Remote/Client 自动化已验证；最终 tarball 真实浏览器生命周期尚未完成）

## 本增量回答的问题

V4.43 已建立唯一 `ExistingSkillRelease` Host mutation gate，但人工只能通过 Command 操作。V4.44 把同一个 owner 的权威状态和动作接入现有 `EvolutionControlPlane`、DSH Typert Remote 与 `dsh-evolve-web`，不新增 Store writer、Generation pointer writer、审批系统、Session、Goal、Runtime 或 Gateway。

## 实现事实

- `EvolutionOverview.existingSkillRelease` 只投影 bounded browser-safe 数据：Candidate/Skill、exact baseline 与 Candidate archive/tree、声明 diff、Admission/Holdout/Retention id、inactive Generation id、状态、阻断原因和 future-Session active 状态。Candidate body、protected case、Host 路径、provider identity 与凭据不出 Host。
- eligibility 只调用 V4.43 的 `ExistingSkillRelease.scan()`；Control 不重写 `qualified + improved + retained` 判定。Candidate 投影必须与 release result 一一对应，否则整个读取失败关闭。
- `approveExistingSkill`、`rejectExistingSkill` 与 `promoteExistingSkill` 只是同一 owner 的结构化适配。批准仍只发布 inactive Generation，晋升是另一明确动作，现有 Session 不漂移。
- Typert 静态合同和固定 DSH revision 生成物新增三个 exact 方法；生成物校验脚本同时固定方法集合和 wire 参数，Client 不使用手写旁路协议。
- DSH Web 在 Skills 视图显示 release baseline/Candidate/diff/保留文件/三段证据、eligible/approved/rejected/blocked 与 active 状态；每个 Candidate 有独立人工备注，approve/reject/promote 都需要确认。页面只调用 Remote，不能读取 Storage 或直接移动 Generation pointer。
- 顶部 actionable 数包含 existing-Skill release；若只有该门需要处理，概览按钮直接进入 Skills，而不是把用户带到 capability-absent Review。

## 自动化证据

- `evolution-control-plane.test.ts`：精确 bounded 投影不泄露私有路径或 proposer claim；批准 receipt 保持 inactive；promote/reject 逐项委托唯一 Host owner。
- `evolution-remote.test.ts`：运行时 Remote 注册、Cordis service key、方法顺序和 exact 参数委托。
- `evolution-action.client.test.tsx`：真实 React Client 交互显示 exact evidence/diff，备注后 approve 先进入确认，批准后仍未 promote；权威刷新为 approved 后再单独确认 future-Session promote。
- 聚焦验证：Control/Remote 2 files / 9 tests passed；Web 1 file / 19 tests passed；`dsh-evolve` 与 `dsh-evolve-web` TypeScript typecheck passed。
- 仓库全量 `pnpm check`：文档链接与 public-path 检查、11 个包 typecheck、499 tests passed / 3 skipped、全包 build 均通过。

## 发布边界

- 本增量当时尚未从最终 `npm pack` tarball 在 clean profile 里验证真实浏览器生命周期；后续 [V4.45](v4-45-existing-skill-release-final-browser.zh.md) 已完成 reload、Host 断连保留、同端口恢复、approve→restart→promote、官方卸载与 console error 0。
- failed-Outcome Canary Host/Jobs 已由 [V4.46](v4-46-existing-skill-failed-outcome-canary.zh.md) 补齐；其 Control/Web、证据驱动精确回滚、两套独立真实 provider、真实飞书 exact route、Hermes paired benchmark 与长期误晋升/负迁移/误回滚数据仍阻止 tag 和完成声明。
