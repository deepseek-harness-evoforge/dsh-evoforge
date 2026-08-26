# V5.28：Evolution Surface 迁入原生 Control Center

- 日期：2026-08-26
- 提交：`8dcbb7d`（`refactor: consolidate user install surfaces`）
- DSH 设计基线：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- 状态：`implemented`；迁移后的 Evolution 最终 tarball 浏览器纵切仍是发布前门

## 变更

`dsh-evolve-web` 不再把完整进化控制面注册到 `sidebar.footer.action` 或固定弹窗。它现在通过 DSH 原生
`conversation.view` 所声明的 `evoforge.control.surface` child slot，向 `dsh-control-center` 提供一个
Session-scoped Evolution Surface。Gateway、Feishu 和 Evolution 共用 Control Center 的导航、状态、指标、
Section、Entity、Notice、Button、Empty 和 Loading 原语；各自的 Host Remote 和权限仍保持独立。

旧的 `EvolutionAction` 导出只作为兼容包装保留，活动 DSH registration 不再使用它。这样旧嵌入者可以渐进迁移，
而新安装不会得到第二个页面壳、第二套状态入口或 fixed dialog。

## 验证

- `pnpm --filter dsh-evolve-web typecheck` 通过；
- `pnpm --filter dsh-evolve-web test`：2 files / 26 tests passed；
- `pnpm --filter dsh-control-center test`：2 files / 4 tests passed；
- `pnpm check:suites`、`pnpm check:docs` 和根级 `pnpm check` 通过；
- `pack:suite --suite control` 生成 `dsh-control-center` 与 `dsh-evolve-web` 官方 tarball；
- DSH 官方 CLI 在隔离 profile 中安装完整 12 包 tarball、dump、boot（备用端口）、remove 和 readback 通过。

## 尚未关闭的门

本增量的临时 profile 没有持久 Workspace，因此浏览器只验证了 DSH Web boot 和页面加载，没有把迁移后的
Evolution tab 冒充为真实 Workspace/Session 浏览器验收。发布前必须用最终 tarball 在带真实 Workspace 的
profile 中验证：进入 Control Center、切换 Evolution Surface、刷新、Host 断连时保留快照、恢复后重新读取、
console error 为零，以及官方卸载后入口消失。该门不改变现有 Gateway/Feishu Control Center 的 V5.27 证据。

这项迁移也不证明真实 Provider、真实飞书长期运行或 Hermes paired benchmark 已完成；这些仍阻止首个发布 tag。
