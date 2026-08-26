# V5.47：安装入口公开分类证据

> 日期：2026-08-26；提交：`f588505`；状态：`verified`

## 目的

物理 DSH Bundle 仍需按生命周期、权限和外部依赖独立安装，但普通用户不应面对十二个内部包或九个同等
套件名称。本增量把打包命令的帮助输出改为明确区分用户入口、可选附加能力、兼容/高级入口和维护者验收入口。

## 验证

```text
Usage: node scripts/pack-suites.mjs [--suite <name>] [--channel <feishu|telegram>] --out <directory> (default: core)

User-facing suites: core, channels, delivery, continuity
Optional add-on: attention
Compatibility/advanced: evolution, control, gateway
Maintainer-only: full
```

- `pnpm run pack:suite -- --help`：成功，默认套件为 `core`；
- `pnpm run check:suites`：3 tests passed；
- `pnpm run check:docs`：通过；
- `pnpm check`：通过（全包 typecheck、测试和构建）；
- GitHub CI `32974690241`：Node 22、Node 24 及 DSH `0.1.0-rc.5`/`0.1.1-rc.2` assembled jobs 均通过；
- 帮助输出不读取凭据、不启动 DSH、不调用模型或外部平台。

## 边界

这项变更只减少用户需要理解的安装选择，不创建 Meta Bundle，不改变 DSH 官方 `plugin add/remove`，也不
合并 Gateway、渠道 Adapter、Control Center、Evolution 或 OS service 的独立权限和生命周期。兼容入口仍供
旧脚本使用，但不属于新用户推荐路径。
