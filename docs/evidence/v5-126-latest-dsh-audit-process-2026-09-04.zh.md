# V5.126：最新 DSH 审计固化到开源流程

## 变更

为避免开发者在旧 checkout 上继续迭代，或把 DSH 上游构建缺陷误报为 EvoForge 回归，本轮把最新 DSH 审计写入
`CONTRIBUTING.md` 与 `docs/releasing.zh.md`：任何代码修改、测试和发布预检前，必须 fetch tags/prune，确认
`HEAD == origin/master`、版本/tag、依赖和 clean worktree，并把 revision 记入证据。

最新 master 自身不可构建时，流程要求保留上游日志，使用已审计支持基线进行可构建验证，不修改 DSH、不静默
回退，也不把上游失败算作插件失败或通过。

## 验证

```text
DSH_DIR=<canonical-dsh-checkout>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
pnpm run check:docs
pnpm run check:release:gates:test
git diff --check
```

本轮 DSH 最新远端为 `76fda729799fe9b3848dbe2c211d4b231032b81e`；其根级 tsdown 入口缺失仍是上游事实，
支持基线继续为 alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
