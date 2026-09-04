# V5.148：Telegram AS-1 API 参数修复后的 alpha.5 全仓回归

日期：2026-09-04  
EvoForge revision：`030cd6f`（回归命令执行后仍为同一 clean revision）  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，`HEAD == origin/master`，clean。  
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 命令与结果

执行前重新 fetch canonical DSH 并核对 revision、版本、tag 和完整 worktree 状态；随后执行：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：退出码 `0`。文档、CI/套件/发布 gate、tag/version、npm 名称、DSH 兼容性、Hermes EV-1 类型门、Provider RP-1
合同、Feishu AS-2 合同、Telegram AS-1 类型与 `8/8` 合同测试、12 个 Bundle 的 typecheck、全部测试和全部构建均通过。
其中 Gateway `41/41`、Feishu `46/46`、Telegram `34/34` 测试通过；EvoForge 工作树在命令结束后保持 clean。

## 本轮变更边界

本次回归覆盖 Telegram AS-1 执行器把可配置 API endpoint 传入最终 DSH overlay 的修复，确认该修复未改变授权前零副作用
合同、官方 Bundle 打包边界或其他插件。没有读取真实 Telegram/Feishu 凭据，没有连接外部渠道，也没有发送消息。

## 证据边界

全仓绿灯只证明已审计 alpha.5 支持基线上的工程回归，不证明真实 Telegram Bot、真实 Feishu AS-2、真实 Provider、同任务
同模型 Hermes paired、长期负迁移/遗忘/重复外部效果或 npm 命名空间发布门。`real-telegram-as1` 仍为 `not-run`，首个
release tag 继续阻断；不能把本轮回归宣称为真实渠道通过。
