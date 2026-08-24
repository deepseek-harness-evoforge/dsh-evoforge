# V4.56：治理 Provider 请求硬上限

## 结论

真实 Provider 路径审计发现一个可复现的可靠性缺口：两个 proposer HTTP seam 已有 60 秒 wall-clock
timeout，但缺失 Skill 的 admission/holdout/Retention 治理作者和现有 Skill 的 holdout/Retention 治理作者
都只在调用方显式传入 signal 时才可取消；默认路径可能无限等待。

两个治理 seam 现在都始终保留 60 秒硬上限。有 Host signal 时使用组合 signal，任一 cancellation 或 timeout
都会终止请求；Host 不能通过提供自己的 signal 意外移除硬上限。实现保持在各自私有 Provider adapter 内，
没有新增公共 Provider 抽象、插件、Runtime、Session、Goal、市场或能力获取入口。

## 故障语义

本增量没有改变既有付费调用治理：

1. 调用前先 durable 写入 `authoring-pending` 和 exact pending role；
2. Provider 异常、取消或 timeout 后转为 `uncertain`；
3. 重启看到 pending/uncertain 会拒绝自动重发同一付费调用；
4. timeout 只把无限等待变成有界未知结果，不把未知结果伪装成失败、成功或可安全 retry；
5. evaluator 仍无发布权，Candidate 仍不能影响当前 Session。

## TDD 证据

修复前先加入两个使用受控 fake `fetch` 的合同测试。原实现的两个测试都失败，精确显示
`RequestInit.signal` 为 `undefined`：

```text
Test Files  2 failed (2)
Tests       2 failed | 15 passed (17)
```

实现后，同一测试验证：缺失 Skill 默认治理请求获得 timeout signal；现有 Skill 在收到 owner signal 时获得
不同的组合 signal，且初始未取消。

```text
pnpm --filter dsh-evolve exec vitest run \
  test/skill-evaluation-governance.test.ts \
  test/existing-skill-holdout-governance.test.ts
→ 2 files passed
→ 17 tests passed

pnpm --filter dsh-evolve typecheck
→ passed

pnpm --filter dsh-evolve test
→ 67 files passed / 1 skipped
→ 294 tests passed / 1 skipped
```

```text
pnpm check
→ documentation links/public paths passed
→ RP-1 typecheck 与 8/8 无调用合同 passed
→ 11 个 workspace package typecheck passed
→ 542 tests passed / 3 skipped
→ 11 个 workspace package build 与 artifact verification passed
```

## 证据边界

fake `fetch` 只证明请求边界和 signal 组合，不证明真实 Provider 可用性、生成质量或 60 秒后的远端结算状态。
本次没有精确付费授权，也没有第二套独立 Provider，因此未发起外部请求，RP-1 仍为 `NOT_RUN`。真实飞书
exact route、长期 Outcome、Hermes paired benchmark 和 v0.1 发布门仍未完成。
