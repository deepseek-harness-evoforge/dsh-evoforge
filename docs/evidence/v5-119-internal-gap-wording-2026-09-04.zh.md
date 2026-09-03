# V5.119：自我发现文档边界措辞修正

## 结果

`dsh-evolve` 用户 README 中的“background discovery”容易被误解为运行时能力获取。本轮改为“internal evidence
processing”，明确 `report_capability_gap` 只持久化 DSH 内部缺口，后续仍只能消费已安装能力、Goal、反馈和结果，
不会搜索、下载、导入或安装外部 Skill。

## 验证

在 canonical DSH 最新 master fetch/clean preflight 后执行：

```text
pnpm run check:docs
git diff --check
```

结果：文档链接和公共路径检查通过，差异检查通过；未修改运行时逻辑、Bundle、DSH 上游或外部状态。

## 未完成门禁

真实 Feishu AS-2、真实 Provider、Hermes paired、长期效果、Telegram 和 npm 命名空间门仍保持原状态。
