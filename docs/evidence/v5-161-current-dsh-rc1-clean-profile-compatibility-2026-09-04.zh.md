# V5.161：canonical DSH rc.1 clean-profile 兼容验收

日期：2026-09-04  
EvoForge revision（fixture 修复前）：`70fec6a45bf28f7af5d5a4c6e6bca7d9d37ead1b`  
canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`dsh-v0.1.2-rc.1`，`origin/master`，clean）  
已构建支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）

## 发现与修复

先用 canonical DSH rc.1 执行 clean-profile 纵切，安装/启动/Goal/卸载阶段均能运行，但在恢复读回时以
`nativeCtx.sessionPersistence.load is not a function` 失败。源码审计确认 rc.1 的官方持久化契约已改为
`open(id, 'read')` → `handle.read()` → `handle.close()`；alpha.5 支持 checkout 仍只提供历史 `load()`。

修复仅作用于验收 fixture：优先调用当前官方 handle seam；当且仅当 pinned alpha.5 没有 `open` 时回退旧 `load`。
EvoForge 产品运行时代码没有引入旧接口，也没有修改 DSH。

## 双基线结果

使用相同命令 `pnpm --filter dsh-software-delivery exec vitest run test/clean-profile-suite.e2e.test.ts --maxWorkers 1
--reporter verbose`，分别设置 canonical rc.1 与 alpha.5 的 `DSH_EVOLVE_DSH_SOURCE_DIR`：

- canonical rc.1：`1` 个测试通过，退出码 `0`，约 `39.39s`；
- alpha.5：`1` 个测试通过，退出码 `0`，约 `43.36s`；
- 两侧均覆盖四套用户 Bundle 的官方 add、dump、Host boot、原生 Session/Goal/Storage、Tool 调用、dispose、
  官方 remove 和卸载后 Session/Goal 读回；Host lifecycle probe 没有浏览器自动打开动作。
- 两侧 fixture 类型检查、文档门禁和 `git diff --check` 均通过。

## 结论边界

这是当前 DSH rc.1 与已构建 alpha.5 的 clean-profile 生命周期兼容证据，证明了最新持久化 API 迁移不会阻断用户套件。
它不等于 rc.1 根级构建已通过：上游 root tsdown 入口缺陷仍按迁移审计记录；因此正式支持声明仍锁定 alpha.5，真实
Feishu/Telegram、Provider paired、Hermes 完整 paired、长期效果和 npm 发布门禁不变。
