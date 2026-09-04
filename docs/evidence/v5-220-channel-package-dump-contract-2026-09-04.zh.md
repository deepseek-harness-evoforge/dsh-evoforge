# V5.220：渠道包 dump 逐 Bundle 安全语义回归

日期：2026-09-04  
范围：把 channels 安装后的 Gateway/Adapter 启停语义从“任意位置出现 disabled”提升为按 Bundle 区段精确验证。

## 验证

在已审计 DSH 支持 checkout 上运行最终 tarball 的 clean-profile 安装/卸载测试：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-dsh-support-checkout> \
  pnpm --filter dsh-evoforge-feishu exec vitest run test/package-install-remove.e2e.test.ts --maxWorkers 1

DSH_EVOLVE_DSH_SOURCE_DIR=<audited-dsh-support-checkout> \
  pnpm --filter dsh-evoforge-telegram exec vitest run test/package-install-remove.e2e.test.ts --maxWorkers 1
```

结果：Feishu `1/1`、Telegram `1/1` 通过；两条测试均完成 tarball 打包、官方 `plugin add`、profile dump、
依赖解析和官方 remove。

## 断言改进

测试现在按 DSH dump 的 `# == <package>` 区段读取状态：

- `dsh-evoforge-gateway` 区段不得出现 `disabled: true`，保证常驻 Host Gateway 安装即启用；
- `dsh-evoforge-feishu` / `dsh-evoforge-telegram` 区段必须出现 `disabled: true`，保证没有凭据和精确 route
  时平台 Adapter 不建立外部连接。

这样即使未来某个无关 Bundle 恰好被禁用，也不会掩盖 Gateway 被误禁用或 Adapter 被误启用的回归。

本轮未读取平台凭据、未发送消息；真实平台和发布门禁状态不变。
