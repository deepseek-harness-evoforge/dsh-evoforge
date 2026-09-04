# ADR-0100：一个默认产品入口，Bundle 边界不合并

- 状态：accepted，2026-09-05 修订
- 原始日期：2026-08-26

## 背景

EvoForge 有多个可独立卸载的 DSH Bundle，因为 Evolution Host/Client、Gateway、平台 Adapter、交付和 OS service
拥有不同生命周期、权限和故障域。把每个 Bundle 都暴露成用户选择会制造产品碎片；把它们合成巨型 Bundle 又会
破坏最小权限和独立卸载。

## 决策

1. `product` 是唯一默认安装入口，一次包含 evolve、doctor、control-center、evolve-web、gateway、feishu、telegram。
2. `delivery` 与 `continuity` 是公开可选结果，`attention` 是可选提醒桥。
3. `core`、`channels`、`evolution`、`control`、`gateway` 只用于旧部署迁移或独立开发；`full` 只用于维护者验收。
4. 安装器从 suite manifest 读取 exact 包名和 SHA-256，保存到持久内容地址后调用 DSH 官方 `plugin add`；套件
   本身不是新 Runtime、Meta Bundle 或 registry。
5. 物理 Bundle 只有在共享同一用户结果、权限、生命周期和外部信任域时才允许合并。Control Center 只拥有一个
   原生 `conversation.view` 与 child slot，各插件仍拥有自己的 Host 权威。

Gateway 在 `product` 中启用但 routes 为空；平台 Adapter 默认关闭，配置 CredentialProvider 和 pairing/exact route
后才连接。这样一行安装即可得到完整可见产品，又不会在未授权时触碰平台。

## 取舍

- 用户只需理解一个默认产品和少数附加结果，DSH profile 内仍会出现多个真实 Bundle。
- 独立 Bundle 允许分别禁用、升级、卸载和审计，但 suite manifest 与包 manifest 必须持续通过自动一致性检查。
- 拒绝 `dsh-evoforge-all` 巨型 Meta Bundle：它会隐藏权限、产生重复 patch，并使局部故障拖垮全部能力。

## 验证

- `pnpm run check:suites` 校验 audience、包集合、默认值和安装器合同。
- `pnpm run dsh:install` 默认生成 `product`，校验 manifest 后只把持久绝对 tarball 路径交给 DSH。
- clean-profile 发布门仍需验证 add/dump/boot/reload/dispose/remove/readback；本 ADR 不把本地打包测试冒充发行完成。
