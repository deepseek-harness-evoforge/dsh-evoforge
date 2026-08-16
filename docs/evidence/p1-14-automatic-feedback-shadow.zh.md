# P1.14 Automatic Feedback Shadow 实现证据

> 声明等级：`implemented`。本页证明一条明确纠错可在静态授权下自动进入既有证据链；不声明真实
> provider 净收益、全新 evaluator 自动可信、生产自治或“永远自我改进”。

## 用户断点与最小实现

P1.8 已提供安全的显式 Shadow Launch，但每条已有 evaluator 的明确纠错仍要人工执行同一个命令。
P1.14 增加一个 host-only `scanOnce()` 编排器和 `automaticFeedbackTargets` 引用配置；它复用
Feedback Signal、Feedback Case Draft、Feedback Shadow Launcher、native Jobs、Shadow Supervisor、
Review、Automatic Retention 与 Auto Promotion，没有新增数据库、daemon、queue、Tool、Prompt 或 UI。

## Test-first 证据

定向 TDD 先观察到真实 DSH 纵切在 feedback 后超时，随后实现并转绿。覆盖：

1. 一个 Signal + 一个 pinned Generation Skill + 一个 exact Target 只启动一次；
2. 同一 Generation 匹配多个已授权 Target 时拒绝自动选择并给出有界 warning；
3. 空、mutable hash、相对路径、重复 id/Skill 配置 fail fast；
4. 自动 launch 若停在 `proposal-pending`，第二次扫描复用 durable 状态且 proposer runner 仍只调用一次；
5. enabled/disabled 的完整真实 Agent request 相等，配置 id/hash/path 不进入模型请求；
6. packed plugin 配置包含自动 Target，真实 profile add/boot/dispose/remove 后原生 DSH composition 不变。

## 真实 DSH 纵切

macOS 测试使用 pinned DSH Storage、Agent、Skill invocation、Message Feedback、Session Persistence、
native Jobs、真实 assembled DSH evaluator、Git Generation、ReviewInbox、Retention 与 release policy：

```text
explicit correction
→ private Draft
→ one proposer request
→ four-execution calibrated assembled Shadow
→ append-only clear win
→ zero-proposer four-execution Retention
→ inactive Git Generation
→ future-Session activation
```

断言结果：proposer 请求恰好 1；普通 Agent adapter request 在整个后台链中无增量；原 Session 仍固定
baseline Generation；future Session 才读取 correction；用户仓库 HEAD、工作树和 Skill 文件完全不变；
Retention report 为 exact `retained` 且 `proposerCalls: 0`。

## 本地验证结果

- `dsh-evolve`：170 passed / 2 skipped；
- 新自动服务与 launcher 定向测试：9/9；
- 真实 feedback → future Generation 纵切：1/1；
- PA-1：Evolve 58/58、Software Delivery 22 passed / 1 skipped、Web 8/8、Telegram 22/22；
- 全仓顺序复跑：Doctor 5/5、Software Delivery 26 passed / 1 skipped、Telegram 37/37、Web 9/9；
- 全部 typecheck、build、文档链接、Node artifact、Typert artifact、diff check 与 packed
  install/boot/dispose/remove 通过。

GitHub Node 22/24 与 macOS CI 结果在 Draft PR 终态后补入。

关键文件：

- `packages/dsh-evolve/src/automatic-feedback-shadow.ts`
- `packages/dsh-evolve/src/feedback-shadow-launcher.ts`
- `packages/dsh-evolve/src/index.ts`
- `packages/dsh-evolve/test/automatic-feedback-shadow.test.ts`
- `packages/dsh-evolve/test/feedback-shadow-launcher.test.ts`
- `packages/dsh-evolve/test/generation-binder.e2e.test.ts`

## 仍未证明

- 真实用户的 correction→Candidate 改善率、误晋升率、review rate、单位成本与返工下降；
- 多 Skill Generation 的歧义频率，以及一个静态 Target 是否足够覆盖常见失败类；
- 新失败的 evaluator 仍必须经 P1.9 人工语义资格验证，未实现自动 trust；
- 磁盘耗尽、陌生用户配置、Linux/Windows sealed backend 与生产多日常驻证据。

契约见 [P1.14](../architecture/p1-14-automatic-feedback-shadow.zh.md)，决策见
[ADR-0034](../adr/0034-explicit-feedback-may-enter-one-static-shadow-target.md)。
