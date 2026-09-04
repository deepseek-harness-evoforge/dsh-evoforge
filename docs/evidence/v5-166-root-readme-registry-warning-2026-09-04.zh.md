# V5.166：根 README registry 安装风险提示

日期：2026-09-04  
EvoForge revision：`7d558fe9ba836488a4562e448eb0dee19072ffd4`  
当前 registry 状态：未发布；npm 名称门禁仍 `blocked`

## 修正

根中文、英文 README 在本地 tarball 安装命令前增加明确警告：项目尚未发布 registry 包，用户不要直接把
`dsh-*` 名称交给 DSH，以免安装无关同名包；必须先由仓库生成套件 tarball，再用官方 `dsh plugin add`。

## 验证

```text
pnpm run check:docs
git diff --check
```

两项通过。该提示只防止错误安装，不改变 DSH、Bundle、运行时、命名空间或发布门禁。
