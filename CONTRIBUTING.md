# Contributing to dsh-evoforge

感谢你帮助构建更可靠的 DeepSeek Harness 扩展。本项目处于 pre-alpha，优先接受能够缩短 P0 证据链的、小而完整的贡献。

## 贡献边界

一个新能力必须回答：

1. 谁会安装它，得到什么新的用户结果？
2. 如果 DSH 完全符合文档，它是否仍然有价值？
3. 为什么现有 DSH Service/插件组合还不能直接完成？
4. 它改变哪些模型可见内容、权限、状态和外部效果？
5. 如何测量收益、KV Cache 影响、卸载和回滚？

如果第二问为否，请向 DSH 上游提交最小复现，不要在 EvoForge 增加 monkey patch 或长期 workaround。

## 开发流程

1. 在任何代码修改或测试前，先对 canonical DSH checkout 执行 `git fetch origin --tags --prune`，核对
   `HEAD == origin/master`、当前 tag/版本、依赖和 clean worktree，并把 revision 记入证据；最新 master
   若自身不可构建，记录上游失败事实后只能使用已审计的支持基线，不得修改 DSH 或把上游失败归因于插件；
   推荐先运行 `pnpm run audit:dsh:latest -- --source /absolute/path/to/deepseek-harness --json`，它会给出
   机器可读的 revision、安装和构建分类；未知失败不能被当作已知上游缺陷吞掉；
2. 阅读根目录 `CONTEXT.md`、适用 ADR 和对应阶段契约；
3. 用一句话写清用户结果和非目标；
4. 先添加穿过公共接缝的失败测试；
5. 实现最小纵切，不为假想复用发布公共抽象；
6. 运行 `pnpm check`；
7. 若改变 DSH runtime 接缝，补安装、组装、dispose、移除与完整 composition/cache 证据；
8. 若改变 Web/GUI，使用真实浏览器覆盖可见成功路径、刷新后的权威状态和失败反馈。

Hermes paired slice 有冻结的历史入口和跟随当前支持组合的入口。历史 `pnpm benchmark:hermes` 只用于复核旧
epoch，DSH revision 不匹配时必须保持 fail closed；在最新 DSH 开发/验证中，使用已审计可构建 checkout 和固定
Hermes revision 运行：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/audited-dsh-support \
EVOFORGE_HERMES_SOURCE_DIR=/absolute/path/to/hermes-revision \
pnpm benchmark:hermes:current
```

该命令只覆盖无网络的确定性 paired slices，不等于真实 Provider、渠道或整体上位替代验收。

用户安装面使用 [能力套件](docs/capability-suites.zh.md)，不是要求用户逐个理解内部 Bundle。新增包前先证明它拥有独立的生命周期、权限、外部依赖或卸载边界；否则应扩展现有套件或删除重复入口。套件清单必须通过 `pnpm run check:suites`，不要在包之间复制 Gateway、Control Center、Session、Goal 或审批状态。

发布只从 `main` 产生。提交前运行 `pnpm check` 和 `pnpm run check:release -- --allow-dirty`；真正 tag 前必须在 clean worktree 运行不带 `--allow-dirty` 的预检，并完成 [发布门](docs/releasing.zh.md) 中的最终 tarball、真实 DSH、浏览器、飞书和 Hermes paired 证据。

## Pull Request 要求

PR 描述应包含：

- 用户结果与非目标；
- 支持的 DSH revision/range；
- 使用的 DSH seam；
- 模型表面与 KV Cache 差异；
- 权限、秘密、网络、费用和外部效果；
- 持久状态、崩溃、卸载和回滚语义；
- 实际运行的测试及结果；
- 已知限制。

默认允许 PR 产生代码、测试、文档和 Draft PR；merge、release、部署、秘密读取、付费验证和不可逆外部动作仍需维护者或明确策略批准。

## 代码约定

- 使用 TypeScript ESM、严格类型和 Node.js 内置能力优先；
- 源码提交到 `src/`，不提交 `dist/`、`node_modules/` 或 `.evoforge/`；
- 错误必须区分 invocation error、incomplete evaluation 和完整业务结论；
- 证据默认保存哈希、计数和引用，不复制秘密、完整 transcript 或无关源码；
- 动态状态保留在 host/control plane，不为状态展示持续改写模型前缀。

行为规范见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，安全问题不要提交公开 Issue，请阅读 [SECURITY.md](SECURITY.md)。
