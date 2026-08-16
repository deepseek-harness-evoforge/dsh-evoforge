# P1.7 证据：全新失败 evaluator authoring Skill

> 日期：2026-08-16  
> 声明等级：`implemented` authoring workflow；不代表任意反馈已能自动生成 evaluator

## 用户结果

仓库新增可执行
[`author-dsh-evolution-case`](../../skills/author-dsh-evolution-case/SKILL.md) Skill。Case 作者可用
它把一个既有 Case Pack 未覆盖的、可复现 DSH Skill 失败收敛为：

```text
failure claim
  → search / known-bad / known-correction / final-test 分区
  → evaluator red / correction green / negative controls
  → zero-model calibrate
  → 一次显式 bounded Shadow
  → hashes、成本、权限和限制 handoff
```

它把最容易出错的 evaluator 输入/输出、assembled composition、trial budget、epoch、隐私和
fail-closed 规则放在一个按需 reference 中；作者不需要从长篇架构报告重建契约。

## 设计与验证

- 初始 `quick_validate.py` 对不存在的 Skill 返回 `SKILL.md not found + exit 1`；实现后返回
  `Skill is valid!`。
- `SKILL.md` 88 行、735 words；reference 95 行、346 words，无模板 TODO。
- `agents/openai.yaml` 明确 `allow_implicit_invocation: false`，避免给普通 Agent/DSH Session 增加
  常驻 Skill 上下文。
- 仓库 `check:docs` 真实遍历新 Skill 与 reference，确认相对源码/example 链接存在且没有私有路径。
- 按 Skill 的作者路径对现有 `browser-e2e-guidance-assembled` Case Pack 执行真实 macOS Sealed
  calibration：known-bad `fail`、known-correction `pass`、model calls/input/output tokens 均为 0；
  Case Pack 前后 hash 同为
  `afcd026154d5b0f3752568986abc6d490bee6491a951597f2485f9bc1673c8f2`。
- 校准使用 pinned DSH
  `47f943859bef60e4160492346772ded9b24f765a`，临时输出已删除，没有 provider 或外部写入。
- 完整 `pnpm check` 通过：`dsh-evolve` 116 passed / 2 skipped，`dsh-software-delivery`
  26 passed / 1 skipped，合计 142 passed / 3 skipped；docs、typecheck 与两个包 build 全绿。

## 首个新失败前向测试

实现 Skill 后，按其完整流程处理了既有公开 Case Pack 未覆盖的新失败：插件开发已获授权且本地
步骤通过后，Agent 把进度汇报误当作完成，在仍有安全、范围内的文档、Draft PR 与远端验证工作时
提前停止。没有复制用户原话、Prompt 或私有项目内容；私有 Case Pack 只保存在 ignored
`.evoforge/`。

- target 是 exact `build-dsh-plugin` Skill，known-bad SHA-256 为
  `3d75e62833a9bbfed0e8134d49ef0e92b6ec4174765087dd39f1975a582dc243`；
- evaluator 同时要求“进度不是完成”“继续安全已授权工作”和三类 bounded terminal conditions；
  两个隐藏 negative control 会拒绝“关键词齐全但允许进度即停”和“永远继续”；
- 首次 red calibration 中 known-bad fail、未修正 correction 也 fail，报告 hash 为
  `8585cbe4ebc185c2021cb592d2473cf0c295e063af86b8f6f7068c650c968974`；
- 加入独立 correction 后，零模型 assembled calibration 为 known-bad fail / correction pass；最终
  Case Pack hash 前后同为
  `91da5e2fc46ea8b229af9e3a8e7fdd6b820c871b58cb5cc7352b1116d5db4ffe`；
- 一次本地冻结 transport Shadow 得到 baseline fail / Candidate pass、10/10 checks、stable
  non-target composition、active Skill unchanged 和 `promote`；Candidate tree hash 为
  `ad4e757e0da59d6d952149d3e75cbfd5c68d3af63363fa1ac3ff1a845c69caf7`，report hash 为
  `f64ef3b3c2e623dbf35873796cc2a662e1c6b1ba9fa796046fa3d83f3246a79f`；
- proposer input/output token 为 0，没有外部 provider、网络或付费；四次 sealed Trial 使用 pinned
  DSH keyless fixture，baseline/Candidate 各 2 次模型调用且 composition fingerprint 相同；
- 明显正向且 bounded 的 correction 已写入 `build-dsh-plugin`，新 Skill hash 为
  `4cee62e2fb9d2915b6468bd70fc445daee030e7e5c9770149256863903422ab6`；Git commit 提供回滚点。

这证明作者流程能从一个新失败走到 calibrated Candidate，并抓住两种近似但错误的负控制；它仍不
证明陌生作者可一次成功、真实模型会遵循该 Skill，或词法状态机能代表全部软件交付行为。后续需要
独立作者可用性测试和真实 provider/任务 outcome，不能用这次 keyless 前向测试冒充。

## Cache、权限与边界

- 该 Skill 是开源仓库的作者工具，不是 `dsh-evolve` runtime 的新模型表面；正常 DSH Session
  的 Tool、Prompt、catalog 和额外 token 都不变。
- 显式调用只增加当前作者会话的 Skill body；校准为零模型。只有后续明确运行 Shadow 才可能调用
  付费 provider，仍需调用者授权。
- Skill 不接收“让模型自由生成 grader”作为成功条件；没有独立 observable、只有主观偏好、需要
  secret 或无法重放时必须停止。
- 它不生成 Candidate、不激活 Generation、不修改 auto-promotion allowlist，也不扩大 merge、
  release、deploy、secret、payment 或不可逆动作权限。

设计取舍见 [ADR-0023](../adr/0023-evaluator-authoring-is-an-explicit-skill.md)。
