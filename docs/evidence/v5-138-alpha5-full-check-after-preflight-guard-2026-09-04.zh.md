# V5.138：DSH preflight 完整工作树门收紧后的 alpha.5 全仓回归

在执行本轮代码前，canonical DSH 已 fetch 并核对为最新 `origin/master`
`76fda729799fe9b3848dbe2c211d4b231032b81e`、版本 `0.1.2-rc.1`、工作树 clean；官方 rc.1 根级构建缺失
tsdown 入口的上游事实仍未修改。EvoForge assembled 运行继续使用已审计可构建 alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

在 `inspectDshTarget()` 改为拒绝 tracked 与 untracked 工作树变更后执行：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果 `CHECK_RC=0`：文档、CI/套件/发布合同、Hermes/Provider/Feishu acceptance contract、12 个 Bundle 的
typecheck、全部测试和全部构建通过。关键计数为：Evolve `69/309`、Gateway `8/40`、Feishu `18/46`、
Telegram `8/29`、Control Center `2/5`、Evolution Web `2/27`、Attention `4/11`；Resident 的既有 skip
保持为声明的非适用测试。构建后 EvoForge 工作树保持 clean。

该回归证明 preflight 安全收紧没有破坏已验证插件，但不改变最新 DSH 上游构建、真实 Feishu/Telegram、真实
Provider、Hermes paired、长期效果或 npm 命名空间发布门的状态。
