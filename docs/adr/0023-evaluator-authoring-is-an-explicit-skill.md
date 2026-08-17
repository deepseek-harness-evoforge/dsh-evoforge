# ADR-0023：evaluator authoring 是显式 Skill，不是自动 grader

## 状态

Accepted，2026-08-16；standalone 校准/Shadow 入口于 2026-08-17 被 [ADR-0041](0041-dsh-is-the-only-runtime-and-install-surface.md) 撤销，显式 authoring 与独立裁判边界继续有效。

## 背景

P1.4–P1.6 已能保存明确纠正、用纠正引导 proposer，并在请求 Candidate 前校准既有 Case Pack。
剩余核心缺口是全新失败没有可信 evaluator。若同一个模型根据一条纠正同时生成 Candidate 和
grader，两者会共享同一盲点；grader 很容易只检查修正措辞或预期实现，形成自证循环。

把 evaluator 生成做成常驻 runtime、模型 Tool、通用 Case SDK 或后台自动循环，还会增加正常
Session 的模型表面、权限和持久状态，但不能凭这些基础设施创造独立真相。

## 决策

先提供仓库内显式调用的 `author-dsh-evolution-case` Skill。它要求作者从一个可复现失败、一个
人工确认修正和一个独立可观察检查出发，并复用既有 Case Pack 与 Sealed Trial。原始版本通过
standalone calibration CLI 交接；当前 Skill 只交接给已安装 Bundle 的 `/evolve evaluator ...`
Commands 与 native Jobs。它规定：

- 一次只覆盖一个 failure class；
- search、known-bad、known-correction 和 final-test 保持分区；
- 先让 evaluator 在 known-bad/negative controls 上变红，再在 correction 上转绿；
- 失准时修改 fixture/evaluator，不允许通过修改 Candidate 修复 grader；
- provider 请求、Shadow 和公开脱敏证据仍是后续显式动作。

Skill 的 `allow_implicit_invocation` 为 `false`。它不加入 DSH profile，不注册 Tool、Prompt、Service
或后台任务；只有作者主动调用时才进入该次作者会话上下文。

## 结果

- 新失败有一条短、可执行、可复核的作者路径，而不是要求每个用户理解完整进化架构。
- evaluator 的独立性、校准、隐私、预算和 exact epoch 成为交付条件。
- 正常 DSH Session 与 `dsh-evolve` runtime 的模型表面和 token 成本不变。
- 本决策不宣称自动生成 evaluator，也不保证任意主观反馈可重放。无法形成独立 observable 的失败
  必须停在 investigation/review；出现多个真实 evaluator 形态前不抽象公共 SDK。
