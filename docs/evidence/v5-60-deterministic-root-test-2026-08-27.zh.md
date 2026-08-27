# V5.60：根测试跨包生命周期串行化

## 问题

V5.58 只串行了 `dsh-software-delivery` 的两个 assembled 文件。根 `pnpm test` 的第一批仍通过
`pnpm -r` 并发启动九个包；其中 `dsh-evolve`、`dsh-evolve-web`、`dsh-evolve-attention` 和 Gateway
渠道包会在各自 `pretest` 中重建共享 peer artifact，`dsh-resident` 同时运行真实 launchd fixture。
本机一次完整根测试因此让多个原本可通过的 assembled 测试同时超时。

## 修复

- 根测试第一批增加 `--workspace-concurrency=1`，让每个包的 `pretest → build → test` 生命周期完整结束后
  再进入下一个包；包内 Vitest 并行策略不变。
- `dsh-software-delivery` 继续使用 V5.58 的快速测试与两个 assembled 文件单 worker 分段。
- Telegram、Feishu 继续各自单 worker，避免真实 transport fixture 与其它包争用。
- `check:ci` 现在验证根测试必须保留跨包串行约束，防止维护时退回不确定的共享 artifact 并发重建。

## 验证

在同一 `main` 工作树执行完整 `pnpm test`，退出码为 0：

- `dsh-evolve`：308 passed、1 skipped；`dsh-resident`：15 passed、1 skipped。
- `dsh-gateway`：35 passed；`dsh-telegram`：29 passed；`dsh-feishu`：45 passed。
- `dsh-software-delivery`：快速批次 34 passed、1 skipped；两个 assembled 文件 2/2 passed。
- 其余 Control Center、Doctor、Attention、Evolution Web、GitHub Review、Goal Continuity 全部通过。
- `pnpm check:ci` 通过新增的根测试编排门。

同样的第一批在不改源码的情况下先以 `--workspace-concurrency=1` 独立验证通过，说明此前超时来自跨包资源和
artifact 竞争，不是靠放宽断言、延长测试超时或跳过测试掩盖业务失败。

## 边界

本增量证明本机完整根测试可重复通过，不替代 GitHub Actions 的干净 Linux/双版本 macOS matrix，也不提升
真实 Feishu、双真实 Provider、Hermes paired 或长期效果发布门。CI 仍须以同一提交实际运行并保留结果。
