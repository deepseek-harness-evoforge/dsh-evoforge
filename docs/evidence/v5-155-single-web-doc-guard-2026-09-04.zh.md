# V5.155：单网页启动约束进入文档门禁

日期：2026-09-04  
EvoForge 测试源码 revision：`26b0736653289fec7b787b46f50c4b96131d3a2d`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，clean。

## 变更

所有面向用户的 README（根文档及五个直接安装 Bundle）和中文上手/套件指南都把手动 Web 启动统一为
`dsh --profile web --no-open`，并说明 Host 只启动一次、复用已有浏览器标签页。`scripts/check-docs.mjs`
新增文档门禁：操作文档出现裸 `dsh --profile web` 启动示例会失败，防止未来回归到重复浏览器交接。

## 验证

开发前已重新核对 canonical DSH revision/version/clean 状态。执行：

```sh
pnpm run check:docs
git diff --check
```

两项均通过。该门禁只约束用户文档，不修改 DSH Web 的官方启动语义，也不读取凭据或产生外部效果；真实渠道、
Provider、Hermes paired、长期效果和 npm 发布门状态保持不变。
