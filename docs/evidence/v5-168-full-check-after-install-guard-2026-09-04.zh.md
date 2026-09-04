# V5.168：安装文档门禁后的 alpha.5 全仓回归

日期：2026-09-04  
EvoForge revision：`36539adee2f3ccae1fe6057afd7c29f3b165842a`  
canonical DSH 最新 `master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，clean）  
assembled 支持 checkout：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`dsh-v0.1.2-alpha.5`，clean）

## 命令与结果

在执行前重新对 canonical DSH `git fetch origin --tags --prune`，确认 `HEAD == origin/master`；随后使用已审计的
alpha.5 支持 checkout 执行：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
CHECK_RC=0
```

本轮覆盖的关键结果：

- 文档、CI 路径、套件、发布合同和所有 acceptance contract 通过；
- Evolution `309/309`，Gateway `41/41`，Feishu `46/46`，Telegram `34/34`；
- Resident `17 passed / 1 skipped`，Software Delivery clean-profile `1 passed / 1 skipped`；
- 12 个 Bundle 的 typecheck、测试和构建均通过，构建后 EvoForge 工作树保持 clean；
- 新增的未发布 registry 裸名称文档门禁通过。

## 边界

这是 alpha.5 支持基线的工程回归，不改变真实 release gate：npm 名称、真实 Feishu/Telegram、双真实 Provider、同条件
Hermes paired、长期负迁移/遗忘/误晋升/重复外部效果仍按 `release-gates.json` 保持阻断。canonical rc.1 的上游根级
构建失败也仍由 [V5.162](v5-162-dsh-rc1-root-build-boundary-2026-09-04.zh.md) 单独记录，未被本轮回归掩盖。
