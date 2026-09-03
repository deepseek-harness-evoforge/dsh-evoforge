# V5.122：修正内容寻址发布边界的过时 Git 语义

## 结果

审计活动源码时发现 `packages/dsh-evolve/src/verified-evolution-store.ts` 的发布边界注释仍称“每个引用的 Git tree
必须 exact”。当前运行时已删除 Git Skill source/ref 和外部获取路径，发布前实际调用的是
`GenerationBundleRepository.providerFor()`，校验内容寻址、不可变 Skill Bundle 的完整性和可物化性。该注释会给
开源贡献者错误地暗示运行时仍依赖 Git，因此改为准确描述“content-addressed Skill Bundle”。只改注释，不改变
运行时行为、状态权威或 DSH 接缝。

## 验证

在 canonical DSH 最新 `origin/master` fetch/clean preflight 后执行：

```text
pnpm --filter dsh-evolve exec vitest run test/generation-store.e2e.test.ts --maxWorkers 1
pnpm run check:docs
git diff --check
```

结果：Generation store 生命周期测试 `10/10` 通过，文档链接/公共路径检查通过，差异检查通过。canonical DSH
保持 `76fda729799fe9b3848dbe2c211d4b231032b81e` 且未修改。

## 未完成门禁

真实 Feishu AS-2、真实 Provider、Hermes paired、长期效果、Telegram 外部通路和 npm 命名空间仍按
`release-gates.json` 保持未通过；本轮不把注释清理冒充产品完成。
