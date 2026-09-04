# 【支持基线快照】DSH 0.1.2-alpha.5 迁移审计（2026-09-03）

> 本页解释当前可构建支持基线，不代表 canonical latest。最新 DSH 身份和构建分类只认
> [2026-09-05 审计](dsh-latest-audit-2026-09-05.zh.md)。

本报告记录本轮开发和测试所使用的 DeepSeek Harness 基线。它是发布前的工程事实，不是对上游稳定性的背书；EvoForge 只在报告中明确列出的 revision 上声明兼容。

## 固定基线

| 基线 | revision | 版本 | 结果 |
|---|---|---|---|
| 本地最新 `master` | `49a606bc5b5934603f22a26957a07dc799ab0291` | `0.1.2-alpha.5` | `pnpm install --frozen-lockfile` 通过；`pnpm build` 在上游 Client bundle 失败 |
| 最新公开 alpha.5 tag | `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` (`dsh-v0.1.2-alpha.5`) | `0.1.2-alpha.5` | `pnpm install --frozen-lockfile` 与 `pnpm build` 通过；用于本轮 assembled/clean-profile 验证 |

每次 EvoForge 代码或测试变更前，先检查 DSH revision、版本和 clean worktree；测试通过后把实际 revision 写入证据文件。DSH 工作树未被本项目修改。

## alpha.5 对插件的实际影响

- Cordis 与 DSH 包版本为 `4.0.2`/`0.1.2-alpha.5`；Bundle、Client Module 和原生 Session 类型必须以这一套依赖解析。
- `ToolCallId`、`JsonValue` 等类型的导入位置已经变化；插件不能继续从旧的 LLM 包导入这些符号。
- Session 事件读取使用 `snapshotEvents()`；当前 `SessionPersistence` 公共面是
  `prepare/load/inspect/borrowSession/readFrom/list/listSnapshots`，不能把旧的
  `open(id, 'read')` 当作公共 API。JSONL 后端的 coordinator 通过内部 `appendBatch` 写入，
  崩溃测试只能在明确的测试夹具中注入该后端 seam，不能让产品运行时依赖私有实现。
- `SessionProjectionRegistry.restore` 的参数顺序和生命周期依赖改变；必须先挂载 projection，再注册 Goal 服务。
- 图片附件仍受 DSH 原生 attachment v1 限制；本轮仅调整合法的尺寸门禁，不在 Gateway 伪造通用 file/audio/video block。

## 最新构建产物核对

最新 alpha.5 tag 先执行完整 `pnpm build`，再执行本轮 assembled/clean-profile 测试；测试进程实际加载
该次构建生成的 `lib`，而不是 checkout 中可能残留的旧产物。之前发现的旧 `lib` 缓存差异已通过重新构建
消除；EvoForge 不修改 DSH，也不以缓存产物替代上游构建。

## 兼容性声明

本轮新增的运行时导入和 persistence 适配以 alpha.5 为准。此前文档提到的 `0.1.0-rc.5` 与 `0.1.1-rc.2` 只代表历史审计记录，不应被理解为当前代码仍支持的运行时。任何旧版本支持都必须重新在对应 DSH 产物上完成安装、boot、Session/Goal、reload/dispose、卸载和 readback 矩阵后才能恢复声明。

历史 suite-upgrade 夹具使用 pre-alpha.5 EvoForge 包；它无法在 alpha.5 中加载旧的 `CallId` 导入，因此本轮明确 skip，并不把 skip 冒充升级通过。当前 alpha.5 的权威生命周期门是 clean-profile assembled 测试。

## 对开源用户的含义

当前推荐用户锁定 `dsh-v0.1.2-alpha.5` 的公开 tag，而不是本地 `master`。项目仍处于 pre-alpha：可以从本地 tarball 安装和复现本轮证据，但尚未声称 registry 稳定发布，也尚未满足真实飞书、真实 provider 和 Hermes paired benchmark 的全部发布门。
