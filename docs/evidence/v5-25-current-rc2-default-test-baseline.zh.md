# V5.25：当前 DSH rc.2 默认测试基线收口

- 日期：2026-08-25
- 当前 DSH：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- 状态：活动默认门修正并通过；冻结 benchmark 与双版本兼容矩阵不改写

## 暴露的问题

项目把默认 `deepseek-harness` checkout 更新到 rc.2 后，根级 `pnpm check` 正确暴露三类遗漏：

1. 五个活动示例 Case Pack 的 `dshRevision` 仍写 rc.5，导致 assembled Trial 在执行前以 revision mismatch
   fail closed；
2. `dsh-github-review` 的组合记录 LLM 只实现旧 `stream()` seam，rc.2 Agent Loop 通过 `prepareCall()`
   准备模型，因此两个测试等待不到请求；
3. 一个 `dsh-evolve` 原生 Command 测试仍按旧三参数签名传 signal，rc.2 把第三参数解释为 images。

这不是放宽 revision 门。相反，活动 Case Pack 必须精确绑定当前默认源码；否则它们要么拒绝最新源码，要么
只能通过跳过 exact revision 检查来制造假绿。

## 修正边界

- 只把五个活动示例 Case Pack 的 exact revision 更新到当前 rc.2；
- 组合记录 LLM 增加与 rc.2 官方 Adapter 相同的 `prepareCall()`，继续把同一 `stream()` 作为唯一请求记录点；
- 原生 Command 测试显式传空 images 再传 AbortSignal；
- 不改冻结 Hermes epoch/result，不改 rc.5/rc.2 compatibility allowlist，不把活动 Case Pack 动态绑定为
  “当前 HEAD”，也不扩大插件 peer 范围。

## 检查

- `pnpm --filter dsh-evolve test`：67 files passed、1 skipped；305 tests passed、1 skipped；
- `pnpm --filter dsh-github-review test`：10 files / 27 tests passed；
- 根级 `pnpm check`：在 V5.26 修复同轮暴露的飞书 sibling-teardown 竞态后通过；活动 rc.2 门、
  RP-1/AS-2 合同、全包类型、测试与构建全部完成。
