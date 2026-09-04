# V5.162：canonical DSH rc.1 根级构建边界

日期：2026-09-04  
canonical DSH revision：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，`origin/master`）  
EvoForge revision：`c5cb448`  
DSH 工作树：clean

## 复核命令

在再次 `git fetch origin --tags --prune`、核对 `HEAD == origin/master` 后，于 canonical DSH checkout 执行：

```text
pnpm install --frozen-lockfile --ignore-scripts --offline
pnpm build
```

依赖安装通过；根级 `pnpm build` 退出码 `1`。失败发生在官方 `build:lib` 的 `tsdown` 解析阶段：

```text
ERROR [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
```

随后 DSH 的 `scripts/build.ts` 报 `build: build:lib exited with 1`。本轮没有修改、删除或补写 DSH 生成目录，构建后
工作树仍 clean。

## 与 EvoForge 的边界

- 同一 canonical rc.1 上，EvoForge clean-profile 安装/卸载 fixture 已通过（见 [V5.161](v5-161-current-dsh-rc1-clean-profile-compatibility-2026-09-04.zh.md)）；这只证明已有 DSH 构建产物可运行。
- 根级 build 缺陷属于 DSH 上游配置/生成入口，不能由 EvoForge 插件掩盖或修复；正式支持声明继续锁定已完整构建的 alpha.5。
- 任何将 rc.1 作为正式支持基线或创建发布 tag 的动作，都必须等待上游根构建修复后重新执行完整兼容、打包、浏览器和真实渠道矩阵。
