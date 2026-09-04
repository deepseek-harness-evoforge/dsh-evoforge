# V5.185：渠道凭据代际切换与失效启动隔离

> 日期：2026-09-04。范围：修复 Feishu/Telegram 原生凭据轮换与常驻 Adapter 启动同时发生时的竞态，确保旧凭据不会成为 live runtime。

## 发现

旧实现把正在执行的启动尝试本身作为共享 Promise。凭据事件在该 Promise 尚未完成时到达，会复用旧解析结果；如果旧 Adapter 的清理抛错，恢复路径也会直接中断。对常驻渠道而言，这会造成“页面显示已保存，但实际仍由旧凭据连接”或“轮换后没有新连接”的不确定状态。

## 修复

- Feishu 与 Telegram 各自维护单调 `credentialGeneration`；每次官方 `credentials/reference-updated` 事件都会使旧代际失效。
- 启动尝试捕获创建时的代际；连接建立后若代际已变化，立即隔离销毁候选，不允许它写入 live runtime。
- `startPromise` 现在是包含清理逻辑的完整运行 Promise；并发调用会等待它真正 settle，再按最新代际重试，不会递归复用旧 Promise。
- 轮换时旧 Adapter 的 dispose 失败只记录 Host 警告，仍继续尝试新凭据；候选清理失败也不会把旧候选提升为 live。
- 没有新增 Gateway、Session、Router、网页或状态库；服务身份保持单一。

## 验证

开发前重新 fetch canonical DSH：`origin/master` = `76fda729799fe9b3848dbe2c211d4b231032b81e`；使用已审计可构建 alpha.5 checkout `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。在 Telegram Cordis 生命周期测试中让第一次凭据解析停顿，再连续提交旧值/新值；结果为旧候选注册后被销毁，新候选注册并成为唯一 live runtime：

| 检查 | 结果 |
| --- | --- |
| Telegram lazy-start 回归 | 1 file / 1 test 通过；覆盖缺失凭据、并发代际切换、旧候选销毁和最终卸载 |
| Feishu 全量测试 | 19 files / 55 tests 通过 |
| Telegram 全量测试 | 10 files / 36 tests 通过 |
| Feishu/Telegram typecheck、build | 通过 |
| 根级 `pnpm run check`（alpha.5 + 当前 DSH 审计） | `CHECK_RC=0` |
| Evolution / Gateway | 309/309、41/41 |
| `git diff --check` | 通过 |

该增量只证明凭据轮换生命周期的确定性，不等于真实 Feishu/Telegram 外部消息、Provider、Hermes paired、长期效果或发布门禁通过；这些门禁仍按 `release-gates.json` 保持阻断。
