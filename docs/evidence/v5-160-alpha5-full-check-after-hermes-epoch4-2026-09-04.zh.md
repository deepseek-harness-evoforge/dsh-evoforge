# V5.160：Hermes epoch-4 基准修复后的 alpha.5 全仓回归

日期：2026-09-04  
EvoForge revision：`70fec6a45bf28f7af5d5a4c6e6bca7d9d37ead1b`  
DSH assembled revision：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）  
DSH canonical revision：`76fda729799fe9b3848dbe2c211d4b231032b81e`（rc.1，`origin/master`，clean）

## 命令

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-alpha5-checkout> pnpm run check
```

执行前重新 fetch canonical DSH 并核对 `HEAD == origin/master`、tag、版本和 clean worktree；DSH 源码没有被修改。

## 结果

低噪声复核明确输出 `CHECK_RC=0`。详细阶段结果包括：文档、CI、套件和发布脚本合同通过；Hermes EV-1、Provider
RP-1、Feishu AS-2、Telegram AS-1 合同类型/测试通过；12 个 Bundle 的类型检查、测试和构建通过。关键计数为：
Evolution `309/309`、Gateway `41/41`、Feishu `46/46`、Telegram `34/34`、Resident `17 passed / 1 skipped`、
软件交付 clean-profile `1 passed / 1 skipped`。

本轮没有读取真实渠道或 Provider 凭据，也没有产生外部平台副作用。`release-gates.json` 中真实 Feishu/Telegram、
Provider paired、Hermes 同模型 paired、长期效果和 npm 命名空间门禁继续保持原状态；全仓回归不等于完整产品发布。
