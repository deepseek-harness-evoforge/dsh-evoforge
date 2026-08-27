# V5.63：公开 Changelog 与飞书发布阻断同步

## 修正

- `CHANGELOG.md` 记录 V5.57–V5.62 的用户可见变化：原生 pending request 审批、AS-2 request-id Host 路径、
  根测试串行化，以及公开能力/安全合同同步。
- `release-gates.json` 的 `real-feishu-as2` 仍保持 `failed`，但 blocker 不再声称当前实现仍等待终端配对码；
  证据同时指向旧超时和 V5.61 的修正合同。
- 新 blocker 明确要求新的真实 direct message、Schedule、Approval、Host restart、uninstall 和 Session
  readback 全部形成 terminal passed 结果，合同或正在等待的 run 均不能提升状态。

## 验证与边界

`pnpm check:docs` 与 `pnpm check:release:gates:test` 通过；`node scripts/check-release-gates.mjs --json`
按预期返回 `status: blocked` 和退出码 1。 本增量只让公开状态与当前实现一致，不改变任何发布结论。
