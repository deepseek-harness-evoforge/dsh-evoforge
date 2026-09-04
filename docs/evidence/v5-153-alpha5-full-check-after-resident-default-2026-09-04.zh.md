# V5.153：常驻网页交接默认修正后的 alpha.5 全仓回归

日期：2026-09-04  
EvoForge 测试源码 revision：`6c683762c61f1c453b7b0a45ece7b5b8b51cd25b`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，clean。  
EvoForge 支持构建：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 验证范围

在 `dsh-resident` 将常驻服务的 `noOpen` 默认改为 `true` 后，重新 fetch/核对最新 canonical DSH，并执行
仓库根级完整检查：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

检查覆盖 DSH preflight、文档/CI/套件合同、发布合同、Hermes/Provider/Feishu/Telegram 验收合同、12 个
Bundle 的类型检查、测试和构建；全程退出码为 `0`。Resident 测试为 `17 passed / 1 skipped`，Gateway 为
`41/41`，Feishu 为 `46/46`，Telegram 为 `34/34`，Evolution 为 `309/309`。

## 结论与边界

默认 `--no-open` 的修正未改变 DSH 的 Session、Goal、Gateway、Adapter 或 Web Surface 权威；它只阻止
launchd/systemd 崩溃恢复反复请求浏览器交接。此次回归未读取真实 Provider/Telegram 凭据，也未产生外部消息、
模型请求或 OS service 效果。真实 Feishu、Telegram、Provider、Hermes paired、长期效果和 npm 命名空间门禁
仍按 `release-gates.json` 保持 `failed`/`not-run`/`partial`，因此本证据不构成发布或 Hermes 上位替代声明。
