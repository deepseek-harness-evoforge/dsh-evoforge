# V5.228：默认产品安装、Case Pack 契约与文档重置

- 日期：2026-09-05
- EvoForge 基线：`10819d0`，实现提交 `3f734c8`、`d3de322`、`2ccf2e9`；本文所在提交只记录验证与文档收敛。
- DSH canonical：`HEAD == origin/master == d347e703908d0406b7a7ef80e3a0e594d86b2215`，tag `dsh-v0.1.3-alpha.1`。
- assembled 支持版本：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（已审计 alpha.5）。

## 交付结果

- 默认套件改为 `product`，一次安装 Evolution、Doctor、Control Center、Gateway、Feishu 和 Telegram 七个独立
  Bundle；Adapter 缺少配置时保持关闭。
- 新增 `pnpm run dsh:install`：exact manifest/SHA 校验、持久内容地址、官方 DSH `plugin add`、不输出完整配置、
  失败保留恢复包。真实 clean-profile 首测发现 Feishu SDK 间接依赖 `protobufjs` 会触发 pnpm `allowBuilds`
  阻断；修复为对预构建 Bundle 显式传递 `--ignore-scripts`，不替用户授予第三方构建权限。
- 五个维护者 Case Pack 删除旧 `search.evidence` 字段和目录，迁移为 `evidence.rationale`；parser 拒绝 legacy
  `search` 与未知顶层字段，并提升 evaluator epoch。
- `examples/`、`benchmarks/` 保留为被测试/发布门引用的维护夹具，不属于用户安装包。工作树中的 evidence 从
  316 份调试记录收敛到 16 份关键证据；ADR 从 104 份历史文件收敛到 15 份当前决策/索引。被删内容仍可由
  Git 历史追溯。

## 验证

在测试前重新执行 canonical DSH `git fetch origin --tags --prune`，确认 revision、tag 和 clean 状态。随后：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-alpha5> pnpm test
pnpm typecheck
pnpm run check:docs
pnpm run check:suites
git diff --check
```

结果：全仓测试共 637 passed / 3 skipped；所有 workspace typecheck 通过；文档链接与公共路径门通过；suite/installer
合同 15/15 通过。Case Pack 专项 10 files / 63 tests 通过，非 assembled Evolution 回归 69 files / 316 tests
通过。

另在仓库外新建空 `DSH_HOME`，用七个最终 tarball 执行：安装器 add 与捕获式 dump 成功；Host 启动并给出唯一
Web URL；官方 `plugin remove` 删除七包；卸载后 dump 与 Host 再次启动成功。持久 manifest hash 为
`83dfc823d1653a03b73c3fbc48de54bcfde5a47f9f8f8db6881b200651c397b4`。测试未写真实用户 profile。

## 限制

本轮没有真实浏览器点击、Session 对话、热 reload、真实渠道消息、真实 Provider 或 Hermes 同模型 paired run。
因此只证明默认本地安装链、构建回归和文档/夹具收敛；registry、Web 当前 head、真实 Feishu/Telegram、自我进化
完整慢环与“上位替代”声明继续阻断。
