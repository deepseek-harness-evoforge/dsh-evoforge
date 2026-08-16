# P0A.3：校准后的 paired final-test 纵切

> 状态：`implemented`，不是完整 P0A 的 `verified` 结论。

## 用户可见结果

`dsh-evolve shadow` 可以读取显式 `search/evidence.md` 生成一个 inactive Skill
Candidate，然后在 macOS 上执行四个相互独立的 Sealed Trial：known-bad、
known-correction、active baseline 和 Candidate。只有校准方向正确，且 Candidate
通过隐藏 final-test 而 baseline 失败，才输出 `promote` 建议；active Skill 从不改变。

公开示例位于
[`examples/case-packs/browser-e2e-guidance`](../../examples/case-packs/browser-e2e-guidance)。

## 已验证事实

CLI 端到端测试跨越真实子进程、本地 HTTP proposer、文件系统、macOS Seatbelt、
退出码和 `report.json`，证明：

- proposer 收到 active Skill 与 search evidence；
- evaluator 中的 sentinel 不进入 proposer 请求；
- known-bad 被拒绝、known-correction 被接受后才评价 Candidate；
- baseline 与 Candidate 进入不同临时 workspace；
- Candidate 胜过 baseline 时报告的 partition 是 `final-test`；
- active Skill 保持原哈希，临时 Trial workspace 被回收；
- Case Pack 在 proposer 或 Trial 期间改变会返回 `2 + incomplete`，不保留 Decision；
- 正常 DSH Session 没有新增 Provider、Tool、Prompt 或 Skill catalog，token/KV-cache
  增量仍为零。

复核命令：

```bash
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve typecheck
pnpm check
```

2026-08-15 本机结果为 2 个测试文件、13 条测试全部通过，随后完整构建通过。

## 不能据此声称

- 固定 HTTP proposer 只替代外部模型边界，不能证明真实模型稳定找到修正；
- 本页 evaluator 是确定性单文件示例，没有运行 DSH 的 parse、typecheck、test、
  load、reload、dispose、removal 或完整 composition；
- 公开 final-test 参与框架开发，不能充当 P0A 退出所需的本地未见样本；
- Candidate 文件只是被 evaluator 读取，没有执行任意模型生成代码；

真实 Loader/Agent/Skill/Tool 的后续装配证据见 [P0A.4](p0a-4-dsh-assembled-shadow.zh.md)，两个产品 fixture 证据见 [P0A.5](p0a-5-cache-safe-status.zh.md)与 [P0A.6](p0a-6-dispose-owned-watcher.zh.md)。它们仍不执行任意 Candidate 代码，也不替代最后一个产品 fixture。
- 仍没有 Linux/Windows Adapter 或 workspace 磁盘配额；
- `promote` 只是离线建议，不会激活、merge 或发布任何内容。

因此这一切片证明“校准、信息分区、paired Decision 与失败关闭”已经可运行，
但“真实持续进化有效”仍待三个 assembled fixture 和本地未见 final-test 证明。
