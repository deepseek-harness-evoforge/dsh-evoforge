# V5.164：未发布 registry 包的用户安装说明纠偏

日期：2026-09-04  
EvoForge revision：`2f2c039fedb8dc28d0b42ce8263fa4bb4ae29961`  
canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，clean）

## 发现

开源可用性审计发现 `packages/dsh-github-review/README.md` 仍示例化执行
`dsh plugin --profile web add dsh-github-review`。当前 npm registry 尚未发布 EvoForge 包，这条命令会把用户引向
不存在或同名的外部包，和根 README 的“本地 tarball only”声明冲突。

## 修正

该 README 现在使用统一的 `pack:suite --suite delivery` → 官方 `dsh plugin add` 本地 tarball 流程，并明确只有
项目自有 registry namespace 和正式 tag 完成后才会切换为 registry spec。没有修改 DSH、Bundle id、运行时、权限或
模型表面，也没有新增网页或安装器。

## 验证

```text
pnpm run check:docs
git diff --check
```

两项均通过。该修正只消除了误导性安装入口，不代表 registry、真实渠道、Provider、Hermes paired 或长期效果门已通过。
