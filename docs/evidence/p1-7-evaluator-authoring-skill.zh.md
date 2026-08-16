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

当前环境没有使用独立 Agent 做前向泛化测试，因此这只证明 Skill 结构、契约链接和规定的真实校准
路径可执行；尚未证明陌生作者能一次写出高质量 evaluator。该可用性证据必须由一个新的真实失败
补齐，不能用现有 fixture 冒充。

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
