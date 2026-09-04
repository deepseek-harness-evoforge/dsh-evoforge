# V5.157：用户套件通过官方 DSH clean-profile 安装与卸载验收

日期：2026-09-04  
EvoForge revision：`76fee814c7ae20695f3dcd83c8c5101be9929c6b`  
DSH canonical revision：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，`origin/master`，干净）  
DSH assembled support revision：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）

## 命令与边界

先执行 canonical DSH checkout 的 `git fetch origin --tags --prune`，随后核对
canonical DSH `HEAD == origin/master` 且工作树无改动。验收命令为：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm --filter dsh-software-delivery exec vitest run \
  test/clean-profile-suite.e2e.test.ts --maxWorkers 1 --reporter verbose
```

测试使用临时 `DSH_HOME` 和临时仓库，不读取真实渠道/Provider 凭据，不产生外部平台副作用。

## 结果

- `1` 个测试文件通过，`1` 个测试通过，退出码 `0`，耗时约 `39.74s`。
- 四个用户套件涉及的 12 个 Bundle 先由 workspace 打包，再经官方 `dsh plugin --profile web add`
  安装；安装后的 profile manifest 依赖和 Bundle 顺序与清单完全一致。
- 官方 `--dump-config` 能发现 12 个 EvoForge Bundle；没有加载重复实例、产品 `bin` 或未声明依赖。
- 官方 DSH Host 启动、原生 Session/Goal/Storage、`complete_delivery` Tool 调用、Goal 完成事件和
  Session flush 全部通过；进程退出后 Fiber dispose 生效。
- 通过官方 `dsh plugin --profile web remove` 卸载 12 个 Bundle 后，profile 只剩 DSH 官方
  `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`；重新启动原生 DSH 后，插件 Tool/Skill 不再出现，
  但已持久化 Session/Goal 完成事件仍可读回。
- Host lifecycle probe 在所有启动点均没有 `opening the default browser` 输出，证明验收未依赖重复浏览器交接。

## 结论

本轮证明的是“用户套件可由官方 DSH 在 clean profile 中安装、运行、卸载并恢复原生状态”的工程事实，不能替代
真实 Feishu/Telegram、Provider paired benchmark、长期效果、npm 名称和真实浏览器外部验收；这些发布门禁仍按
`release-gates.json` 保持原状态。
