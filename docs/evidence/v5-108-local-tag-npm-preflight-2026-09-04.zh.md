# V5.108：本地 release tag 接入 npm 名称实时门

日期：2026-09-04  
EvoForge：`main`  
范围：`scripts/create-release-tag.mjs` 与本地/CI 发布路径一致性

## 发现

GitHub release workflow 已在 `npm publish` 前检查包名归属，但本地 `pnpm run release:tag` 只执行静态元数据和
`release-gates.json`。如果维护者错误地把 registry gate 标成 `passed`，本地路径仍可能创建一个无法发布的 tag。

## 修正

本地 tag 创建命令现在在 release gates 之前调用同一个 `check-npm-package-names.mjs`，冲突、无归属或 registry
异常均 fail closed；没有新增绕过参数。新增脚本合同测试，保证名称检查不会被移到 tag 创建之后。CI 和本地两条
路径现在共享相同的实时 registry 归属判定。

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
node --test scripts/check-release-tag-script.test.mjs  # 1/1 passed
pnpm run check:release:names:test                     # 4/4 passed
pnpm run check:release:workflow                       # 1/1 passed
pnpm run check:release -- --allow-dirty               # passed
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check  # passed
```

实际 npm 归属仍有四个冲突，因此实时名称命令本身按预期退出 1，首个 tag 继续被阻止。
