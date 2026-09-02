# V5.68：修复 assembled CI 的共享渠道构建竞态

> 日期：2026-09-02  
> 范围：`main`、GitHub Actions macOS assembled `0.1.1-rc.2` 任务  
> 结论：修复已提交前通过本地静态门；新的远端矩阵结果仍需等待，不把修复预先写成发布通过。

## 观测

提交 `4aba874` 后的 CI run `33121070764` 只有 `macOS DSH Assembled Trial (0.1.1-rc.2)` 失败。
失败发生在 assembled 测试启动前，错误为：

```text
Cannot find module .../packages/dsh-telegram/dist/index.mjs
```

Node 22、Node 24 和 macOS `0.1.0-rc.5` 矩阵均通过，因此不是 DSH rc.2 API 失败，也不是 Telegram 测试断言失败。

## 根因

CI 的 `Build EvoForge integration packages` 同时声明了直接构建 `dsh-telegram` 和构建
`dsh-evolve-attention`。后者的 `prebuild` 会串行构建共享的 `dsh-gateway`、`dsh-telegram`、
`dsh-feishu` peer。`dsh-telegram` 的 tsdown 输出启用 `clean: true`，两个生命周期在 runner 上重叠时，
一个构建可能在另一个构建产出后清理 `dist/index.mjs`，从而产生非确定性的缺模块错误。

## 修复与防回归

- 从 assembled workflow 删除重复的 `pnpm --filter dsh-telegram build`；保留
  `dsh-evolve-attention` 的单一 peer 构建路径。
- `scripts/check-ci-test-paths.mjs` 增加结构检查，禁止以后在该步骤重新加入直接 Telegram 构建。
- 没有放宽测试断言、跳过 assembled 测试或改变 release gate。

本地 `pnpm run check:ci` 和 `git diff --check` 已通过。修复提交后的 GitHub Actions 仍是唯一的远端确认；
`release-gates.json` 的真实 Feishu、真实 Provider、Hermes paired 与长期效果门不受此修复影响，继续保持阻断。

