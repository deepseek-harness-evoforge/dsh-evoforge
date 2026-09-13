# rc.2 独立依赖安装与构建

- 日期：2026-09-14，EvoForge 起点 `0ab28b0`。
- canonical DSH fetch 后仍为 clean `c291e7961a515f6d7af9304e7fd1d257929aef26`；上游构建产物未修改。
- 从该 EvoForge commit 导出全新源码副本，没有复用/链接原 node_modules，也没有设置类型或 runtime aliases。
  所有依赖改动仅在副本，正式源码依赖与 Host 保持原样。

## 候选依赖配方

将包 manifest 中的 DSH peer/dev `0.1.2-alpha.5` 改为 `0.1.5-rc.2`；按 canonical vendor 元数据将
Schema 改为 `3.18.2`、Loader 改为 `1.0.3`。补齐以下开发 peer 提供者：

- Evolve：`dsh-command-feedback`、`dsh-llm-retry`、`dsh-anonymous-user-id`，均为 `0.1.5-rc.2`。
- Gateway：`cordis-plugin-include@1.0.7`、`dsh-atomic-write@0.1.5-rc.2`、`dsh-home-paths@0.1.5-rc.2`。

初次安装暴露 Loader/Schema 不匹配及缺失 peer，逐项补齐后再次执行：

```text
pnpm install --no-frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
pnpm peers check
pnpm run build
```

安装 exit 0；peer 检查显示 `No peer dependency issues found`；完整根构建 exit 0，包括包间构建、
声明与现有 artifact 检查。这是 npm 发布的 rc.2 依赖，不能将其称为 c291 源码的逐字构建；registry 查询
没有提供 Session 包的 gitHead。此处首次完成了独立新版 node_modules 下的构建，而非旧工具依赖加类型映射。

## 冷恢复和未完成项

在同一独立依赖副本，设置 `DSH_EVOLVE_DSH_SOURCE_DIR=<c291-checkout>`，执行 Continuity 的
`cold-resume.e2e.test.ts` 与 `process-crash.e2e.test.ts`，2/2 通过；子进程使用该副本真实安装的新版
依赖，持久化实现取自指定 checkout。没有 alias 或机器路径 import 改写。模型仍是 keyless fixture。

`pnpm --filter dsh-evolve run typecheck` 的源码阶段通过，但 `tsconfig.test.json` 失败：旧测试夹具仍向
新版 Session 构造器/append API 提供 v0 chunk、无 embedded stream 的 Assistant 和旧 source citations。
因此完整测试迁移、独立全套运行、官方安装/卸载、支持矩阵和真实产品升级仍未完成。不能把 build 通过
等同于测试通过或可以升级用户历史；这些候选 manifest/lockfile 尚未移入正式工作树。
