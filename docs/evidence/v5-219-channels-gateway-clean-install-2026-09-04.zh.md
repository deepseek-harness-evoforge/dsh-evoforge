# V5.219：Channels Gateway clean-profile 安装即启用复验

日期：2026-09-04  
范围：验证 V5.217 的安装语义在真实 DSH CLI `plugin add` 路径中生效，而不是只验证静态 patch 文本。

## 执行

在隔离的临时 `DSH_HOME` 中，用已审计可构建 DSH 支持 checkout 的 CLI 执行：

```text
pnpm --filter dsh-control-center pack --pack-destination <isolated-packs>
pnpm --filter dsh-evoforge-gateway pack --pack-destination <isolated-packs>
dsh plugin --profile fixture add <control-center.tgz> <gateway.tgz> --prefer-offline --ignore-scripts
dsh --profile fixture --dump-config
```

`plugin add` 完成依赖解析并安装两个 tarball；隔离 profile 的基础 DSH peers 未预装，因此 pnpm 输出了
缺少 peer 的警告，但安装命令本身成功，符合“Bundle 不偷偷打包 DSH Runtime”的边界。

## 权威观察

dump 中的 Gateway row 为：

```yaml
- id: evoforge-gateway
  name: dsh-evoforge-gateway
```

该 row 没有 `disabled: true`，因此 Gateway 在 channels 安装后默认启用；只有 Feishu/Telegram Adapter 的
各自 patch 仍保持 disabled，未提供凭据和精确 route 时不会建立外部连接。

## 结论与边界

- 证明了最终 tarball 经 DSH 官方安装路径能保留安装即启用的 Gateway 语义。
- 本次未读取平台凭据、未连接 Feishu/Telegram、未发送消息；完整 native Host boot、真实渠道、Provider、
  Hermes paired、长期效果和 npm ownership 仍由对应 release gate 管理。
- 隔离 profile 的 peer 警告不是产品失败：生产 DSH profile 由官方 base/web Bundle 提供这些 peers；若
  DSH profile 缺少官方 peers，部署者应先修复 DSH 组合，而不是让 EvoForge 私自捆绑第二 Runtime。
