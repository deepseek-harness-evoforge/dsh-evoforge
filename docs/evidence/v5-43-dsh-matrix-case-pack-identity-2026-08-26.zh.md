# V5.43：双 DSH 矩阵的 Case Pack 身份绑定

日期：2026-08-26

## 发现

V5.39 将 assembled CI 扩展到 rc.5 与 rc.2 后，rc.5 runner 的严格身份校验正确发现，活动 Case Pack 的
`epoch.dshRevision` 仍固定为 rc.2。四个 assembled Shadow 因此返回 `incomplete`；这不是可以放宽的兼容性
问题，Case Pack 与 DSH revision 不一致必须拒绝执行。

## 修复

- 新增 `scripts/prepare-dsh-case-packs.mjs`，在每个 CI matrix job 的临时目录复制 Case Pack，并只把副本的
  `epoch.dshRevision` 绑定到当前已审计 checkout。
- assembled Shadow 测试通过 `DSH_EVOLVE_CASE_PACK_ROOT` 读取该隔离副本；默认本地路径保持不变。
- `check:ci` 强制要求 CI 调用该脚本，防止未来把一个 revision 的证据误用于另一个 revision。
- 不修改生产身份校验，不改变 Case Pack 内容、评测器或候选输入，也不把 `incomplete` 当作成功。

## 本地证据

```text
$ DSH_EVOLVE_DSH_SOURCE_DIR=<rc.5 checkout> \
  DSH_EVOLVE_CASE_PACK_ROOT=<revision-matched temporary copy> \
  pnpm --filter dsh-evolve exec vitest run \
  test/dsh-assembled-shadow.e2e.test.ts \
  test/cache-safe-status-shadow.e2e.test.ts \
  test/dispose-owned-watcher-shadow.e2e.test.ts \
  test/profile-install-remove-shadow.e2e.test.ts --maxWorkers 1

Test Files  4 passed (4)
Tests       4 passed (4)
Duration    15.81s
```

该证据只证明本地 rc.5 双身份路径；新的 GitHub Actions 运行仍需完成后才能更新 CI 或 release gate 状态。
