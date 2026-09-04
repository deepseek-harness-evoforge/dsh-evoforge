# V5.170：最新 DSH 审计命令接入后的 alpha.5 全仓回归

日期：2026-09-04  
EvoForge revision：`79a879064c3235508eb11d63f930f18e9f8a9490`  
canonical DSH 最新 `master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，clean）  
assembled 支持 checkout：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`dsh-v0.1.2-alpha.5`，clean）

## 命令与结果

开发前先对 canonical DSH 执行 `git fetch origin --tags --prune`，随后运行：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/clean-dsh-alpha5 pnpm run check
CHECK_RC=0
```

本轮额外确认根 `pnpm check` 已执行 `check:dsh:latest:test`；该分类器单测 `2/2` 通过。全仓关键计数保持：
Evolution `309/309`、Gateway `41/41`、Feishu `46/46`、Telegram `34/34`、Resident `17 passed / 1 skipped`、
Software Delivery clean-profile `1 passed / 1 skipped`，12 个 Bundle 类型检查、测试和构建均通过。

## 边界

本证据只说明最新审计流程接入后 alpha.5 支持回归未退化。canonical rc.1 根级构建的已知上游阻断、npm 命名、
真实 Feishu/Telegram、双 Provider、Hermes paired、长期负迁移/遗忘/误晋升/重复外部效果仍保持原门禁状态，不能
由本地 `CHECK_RC=0` 推导整体发行或 Hermes 上位替代。
