# ADR-0100：能力套件精简用户安装面但保留运行边界

- 状态：accepted
- 日期：2026-08-26
- 决策者：EvoForge maintainer

## 背景

EvoForge 当前有十二个可卸载 DSH Bundle。它们不是十二个同等的用户产品：演化内部阶段、公共 Web Shell、Gateway、平台 Adapter、交付、连续性分别拥有不同的 DSH/Cordis 生命周期、权限和外部效果。把十二个包直接列在安装步骤会让用户误以为必须逐个选择，也掩盖了真实的可选能力；物理合成一个巨型 Bundle 又会把独立的权限和故障域绑在一起。

## 决策

采用仓库级 Capability Suite manifest。默认用户入口收敛为 `core`、`channels`、`delivery`、`continuity` 四个安装预设；`attention` 是可选附加入口，`evolution`、`control`、`gateway` 是兼容/高级入口，`full` 仅供维护者验收。预设由 `scripts/suite-manifest.mjs` 定义，`scripts/pack-suites.mjs` 只负责生成各官方 Bundle 的 tarball、SHA-256 清单、audience 分类和 DSH 安装提示；最终安装、Bundle 激活、升级、卸载和生命周期仍由 DSH 官方命令负责。

本次收敛还把 `channels` 从“Gateway + 两个 Adapter + Control Center + Attention”改为仅包含 `dsh-gateway`、`dsh-feishu`、`dsh-telegram`。控制面通过 `core` 安装，Attention 通过 `attention` 按需安装，避免渠道用户被迫安装不需要的 UI 或通知能力。

保留十二个内部包的独立性。只有当两个实现共享同一用户结果、同一权限/生命周期和同一独立发布边界时才合并；否则使用套件组合，而不是隐藏依赖或创建元运行时包。

`dsh-control-center` 只占用一个原生 `conversation.view` 并声明 `evoforge.control.surface` child slot。`dsh-evolve-web`、Gateway、Feishu 等 Client Adapter 贡献该 slot；旧的固定侧栏弹窗不再是活动注册路径。

## 取舍

- 好处：用户只需按结果安装；每个包仍可单独停用、卸载、审计和升级；能力套件可以在 registry 发布前复用本地 tarball，也能作为 release manifest 的稳定输入。
- 代价：DSH profile 仍会安装多个包；套件脚本不是 DSH 原生新命令，维护者必须持续保持清单与 package manifests 一致。
- 拒绝方案：巨型 `dsh-evoforge-all` Meta Bundle。它会增加一个无独立用户结果的 Bundle 层，隐藏依赖和权限，容易造成重复 patch、错误卸载与兼容性矩阵膨胀。

## 验证

- `pnpm check:suites` 验证所有套件包名已知、无重复、默认/可选/兼容/维护者 audience 分类完整，且 `full` 覆盖全部十二包。
- `pnpm run pack:suite -- --suite core --out <dir>` 生成四个官方 tarball 和 `evoforge-suite.json`，并由 DSH `plugin add` 安装；兼容入口仍可用于旧脚本回归。
- `dsh-evolve-web` Client lifecycle 测试验证它注册 `evoforge.control.surface`，不再注册 `sidebar.footer.action`。
- `pnpm --filter dsh-evolve-web test` 与 `pnpm --filter dsh-control-center test` 覆盖真实 Surface/Compatibility wrapper 行为。
