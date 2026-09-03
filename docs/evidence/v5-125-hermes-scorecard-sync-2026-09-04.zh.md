# V5.125：Hermes 验收表同步当前 EV-1 epoch

## 变更

V5.123 已在当前可构建 DSH alpha.5 上冻结独立 EV-1 epoch-2，但总分卡和原始 paired-benchmark 页面仍只链接
历史 epoch-1。此轮把 V5.123 证据加入两处验收文档，同时保留 epoch-1 原文与结果文件不变。

## 边界

同步内容明确：当前结果是同一确定性 Skill 修正发布控制面的窄对照，支持
`better for deterministic Skill-correction release control`；不支持模型质量、真实飞书/Telegram、长期效果或
整体 Hermes 上位替代声明。没有修改运行时、benchmark 结果或发布门状态。

## 验证

在 canonical DSH 最新 `origin/master` fetch/clean preflight 后执行：

```text
pnpm run check:docs
pnpm run check:release:gates:test
git diff --check
```

三项均通过；`hermes-paired` 仍为 `partial`，未满足的真实 paired 门禁继续阻止 tag。
