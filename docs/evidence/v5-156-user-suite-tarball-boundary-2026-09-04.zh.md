# V5.156：四个用户套件的最终 tarball 边界审计

日期：2026-09-04  
EvoForge 测试源码 revision：`3a07bc0500df7b9169393e0018c40b8c04f74d5d`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，clean。

## 执行

在仓库外的临时目录生成四个用户入口：

```sh
pnpm run pack:suite -- --suite core --out "$PACK_ROOT"
pnpm run pack:suite -- --suite channels --out "$PACK_ROOT"
pnpm run pack:suite -- --suite delivery --out "$PACK_ROOT"
pnpm run pack:suite -- --suite continuity --out "$PACK_ROOT"
```

结果分别为 `4`、`4`、`2`、`2` 个 tarball，每个目录均生成带版本、SHA-256 和 audience 的
`evoforge-suite.json`。对 12 个 tarball 逐一执行归档清单审计，确认不存在 `node_modules/`、`.bin/`
或产品 `bin/` 目录；每个包只含 DSH 官方 Bundle patch、运行产物、类型声明、README、LICENSE 和 package metadata。

## 结论

用户不需要安装或选择 12 个内部包，四个套件是精简安装入口；DSH 仍逐个管理 Bundle 的启停、权限和卸载。
该审计只证明 tarball 边界与套件清单可复现，不等于 clean-profile、真实渠道、Provider、Hermes paired、长期
效果或 npm registry 发布已通过；这些门禁继续以 `release-gates.json` 为准。
