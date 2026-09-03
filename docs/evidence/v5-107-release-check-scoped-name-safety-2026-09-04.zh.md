# V5.107：发布预检与 scoped npm 名称解耦

日期：2026-09-04  
EvoForge：`main`  
范围：`scripts/check-release.mjs` 的 workspace 路径解析

## 发现

未来为解决 npm 名称冲突而迁移到项目 Scope 时，`package.json.name` 会变成形如 `@scope/dsh-gateway`。旧版
发布预检用 `join(packages, manifest.name)` 找 README 和 `cordis.patch.yml`，因此会把合法的 workspace 目录误当成
不存在的路径，无法验证迁移后的公开包。

## 修正

`check-release.mjs` 现在把 workspace 目录名和 manifest 分开读取，并始终用实际目录校验文件；manifest 的 npm
分发名可以是 scoped 或其他合法名称。版本、MIT、仓库、Bundle patch、README、suite manifest 和 clean worktree
约束保持不变。该修正不重命名包、不改变 DSH Bundle row/service id，也不绕过 npm 归属门。

## DSH 前置审计

变更前先 fetch 并确认最新 DSH checkout：

```text
DSH_HEAD=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_MASTER=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_VERSION=0.1.2-rc.1
DSH_STATUS=<empty>
```

## 验证

```text
pnpm run check:release -- --allow-dirty  # passed for 12 packages at 0.1.0-alpha.1
pnpm run check:docs                       # passed
pnpm run check:ci                         # passed
pnpm run check:suites                     # 5/5 passed
pnpm run check:release:gates:test         # 3/3 passed
pnpm run check:release:workflow           # 1/1 passed
pnpm run check:release:names:test         # 4/4 passed
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check  # passed
```

完整检查仍不能改变真实 npm 命名、飞书 AS-2、Provider、Hermes paired、长期效果和 release tag 门禁状态。
