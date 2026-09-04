# V5.178：CI 包名与并发契约修复后的完整回归

日期：2026-09-04  
EvoForge revision：`c962733`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`HEAD == origin/master`，clean  
DSH 最新公开 tag：`dsh-v0.1.2-rc.1`（`a66e470…`）  
组装测试支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`0.1.2-alpha.5`）

## 命令

开发和测试前已执行 canonical DSH `git fetch --all --prune`，确认最新远端 revision 未变化。完整检查使用已审计、
可构建的 alpha.5 支持 checkout：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

首次运行的测试与构建内容全部结束，但外层用错 zsh 管道状态表达式，最终返回包装命令错误
`zsh:test:1: unknown condition: -eq`。该次不作为通过证据。随后取消管道，直接捕获同一根命令退出码并完整重跑；
权威结果为 `CHECK_RC=0`。

## 结果

- DSH alpha.5 revision/version/clean-worktree preflight：通过；
- 最新 DSH 已知构建失败分类器：`2/2`；
- 文档、CI、套件、发布门禁结构、tag/workflow/name、兼容矩阵脚本检查：全部通过；
- Hermes EV-1、Provider RP-1、Feishu AS-2、Telegram AS-1 的类型/契约测试：通过；未把未授权的真实外部运行算作通过；
- Control Center：`5/5`；
- Evolution：`309/309`；
- GitHub Review：`27/27`；
- Goal Continuity：`12/12`；
- Resident：`17 passed / 1 skipped`；
- Doctor：`40/40`；
- Evolve Attention：`11/11`；
- Evolve Web：`27/27`；
- Gateway：`41/41`；
- Software Delivery：`34 passed / 1 skipped`；
- clean-profile / upgrade：`1 passed / 1 skipped`；
- Telegram：`34/34`；
- Feishu：`50/50`；
- 所有 12 个 Bundle 的类型检查和最终构建：通过。

完整回归中没有再出现 V5.177 的 Telegram `dist/index.mjs` 竞态。

## 发布边界

这证明 `c962733` 的 CI 选择与 worker 约束没有破坏现有 DSH 原生安装、生命周期、测试和构建契约。它仍不证明
真实飞书 AS-2、真实 Telegram、真实 Provider、同条件 Hermes 模型 paired、长期效果或 npm namespace 所有权，
所以发布门禁保持阻断，不创建 SemVer tag。
