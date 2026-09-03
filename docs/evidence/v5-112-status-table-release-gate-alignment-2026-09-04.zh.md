# V5.112：状态表与发布门口径对齐

日期：2026-09-04  
EvoForge：`main`

## 发现

状态表把“本地代码合同和 assembled fixture 已存在”写成 `implemented`，但同一仓库的机器门禁明确显示：
真实 Provider 为 `not-run`、最新真实飞书 AS-2 为 `failed`、外部 Telegram/Web newcomer 为 `partial`、Hermes
paired 与长期效果尚未完成。这会让开源用户误以为已经可以生产使用或已经证明优于 Hermes。

## 修正

在能力矩阵前增加权威状态口径：本地实现、静态合同和 fixture 不能覆盖 `release-gates.json` 的真实验收状态；
发布声明必须服从最新门禁和同任务/同模型/同权限/同预算证据。README、发布文档和当前限制已经使用同一口径，未删除
历史证据，也未把失败改成通过。

## DSH 与门禁事实

```text
DSH_HEAD=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_MASTER=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_VERSION=0.1.2-rc.1
DSH_STATUS=<empty>
release-gates.status=blocked
```

当前阻塞包括 npm 名称归属、真实飞书 AS-2、真实 Provider、完整 Hermes paired 和长期效果；这些状态未被本轮文档修正
改变。

## 验证

```text
pnpm run check:docs  # passed
pnpm run check:release:gates -- --json  # 按预期 exit 1，errors=0，blockers 完整列出
```
