# V5.151：Gateway 无入站诊断后的 alpha.5 全仓回归

日期：2026-09-04  
EvoForge 测试源码 revision：`953edd39cc50a1f682a0e8aa6b96fe722b967920`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，clean。  
EvoForge 支持构建：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 目的

在 Gateway 单页加入 Adapter 级“连接正常但尚无入站事件”诊断后，重新执行整个支持仓库的开发前 DSH
审计、合同、类型检查、测试和构建，确认该 UI 变更没有破坏任何 Bundle 边界、原生 DSH 生命周期或安装面。

## 命令与结果

使用 canonical DSH 重新 fetch/核对后，以独立的 alpha.5 支持 checkout 执行：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：退出码 `0`。文档、CI/套件/发布合同、Hermes/Provider/Feishu/Telegram 验收合同、12 个 Bundle 的
typecheck、测试和构建全部通过；Gateway 测试为 `41/41`，Feishu 为 `46/46`，Telegram 为 `34/34`。

本次回归未读取真实 Provider/Telegram 凭据，也未发起任何外部消息或模型请求；真实 `real-feishu-as2` 仍因
有效 WebSocket ready 后未观察到新人入站 pending 而为 `failed`，`real-telegram-as1`、Provider、Hermes
paired 和长期效果门禁状态不变。该结果只证明本地支持矩阵和最终构建无回归，不构成 Hermes 上位替代或真实渠道通过声明。
