# V5.167：未发布包安装命令进入文档门禁

日期：2026-09-04  
EvoForge revision：`13d5041345337e2c1f292358c1ee0d0b88978e36`  
当前 registry 状态：未发布，npm 名称门禁 `blocked`

## 改动

根 README 和 `dsh-github-review` README 的误导性安装命令已修正后，本轮把约束固化到
`scripts/check-docs.mjs`：所有面向用户的 README、上手指南和 Skill 文档若出现
`dsh plugin ... add dsh-*` 裸 registry 名称即失败；本地 tarball 路径和历史 evidence 不受该规则影响。

## 验证

```text
pnpm run check:docs
git diff --check
pnpm run check:release -- --allow-dirty
```

三项均通过。未来项目正式取得 registry namespace 后，应在同一个变更中更新该门禁、README、包名和 release
workflow，并重新跑完整安装矩阵；当前规则不会放行未发布名称。
