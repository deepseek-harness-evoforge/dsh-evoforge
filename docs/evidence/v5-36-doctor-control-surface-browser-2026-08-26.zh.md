# V5.36：Doctor 原生控制面浏览器验证

日期：2026-08-26

## 目的

本增量验证 `dsh-doctor` 是否已经从“只有命令”迁入公共原生 Control Center Surface，并验证它在
DSH Web 断开、恢复和重新读取时不会制造第二份健康状态。该验证不把 Telegram 的真实 Bot 路径或陌生用户
引导误报为已完成。

## 代码与安装面

- `dsh-doctor` 和 `dsh-telegram` 都新增了官方 `dsh.client` 导出，使用 DSH rc.6 的 API remotes、locale、runtime
  和 conversation slot；没有新增 Host Remote、Session、Goal 或状态库。
- Doctor Surface 只执行现有原生 `/doctor` Command；Telegram Surface 只执行现有原生 `/telegram` Command。
  两者共享 Control Center 的导航、状态、错误和无模型说明。
- `scripts/create-browser-doctor-overlay.mjs` 生成一次性的绝对路径测试 overlay，避免把开发机路径写进发布
  包或文档。`packages/dsh-control-center/test/fixtures/` 仅用于浏览器验收，不属于任何 Bundle 的运行时入口。

## 真实浏览器路径

在当前 DSH revision `b150a551`（`dsh-v0.1.1-rc.2`）下，使用 clean 临时 `DSH_HOME`，通过官方 DSH CLI
安装 `core` 与 `channels` tarball，再用生成的 Doctor fixture overlay 启动 `dsh web`。浏览器实际进入原生
Workspace/Session 的 `控制台` tab，未打开固定弹窗或独立页面。

结果：

1. Control Center 导航显示 `运行诊断` 和 `evoforge-evolution`，Doctor Surface 显示 `运行就绪度 / 已就绪`。
2. `检查项=2`、`失败项=0`、`待稳定=0`，`required-plugins` 与 `runtime-failures` 均来自同一次 `/doctor`，无模型调用。
3. 点击 `重新诊断` 后状态和时间戳刷新，页面没有新增控制器或重复健康快照。
4. 停止 DSH Host 后再次点击刷新，页面显示 `诊断读取失败`，同时保留上一次成功报告；没有把旧快照伪装成新成功。
5. 在同一端口恢复 DSH Host、重新加载页面并再次刷新，页面回到 `已就绪`，旧错误消失，控制面恢复可用。
6. 恢复后的浏览器错误日志为 `0`。外部统计请求超时不计入 DSH 应用错误；本次恢复检查没有应用层 error。

## 自动化证据

已通过：

- `pnpm --filter dsh-doctor typecheck`
- `pnpm --filter dsh-doctor build`
- `pnpm --filter dsh-doctor test`（5 files / 40 tests）
- `pnpm --filter dsh-telegram typecheck`
- `pnpm --filter dsh-telegram build`
- `pnpm --filter dsh-telegram test`（8 files / 29 tests）

这些测试覆盖 Client manifest/export、Surface slot、原生 Command 名称、无固定页面注册和稳定报告解析。

## 边界与未完成项

Doctor 的真实浏览器 Surface 已验证，但 Web Control Plane 仍为 `partial`：Telegram 尚未在真实授权 Bot
和真实 Gateway route 下完成同样的浏览器路径；完整陌生安装引导、真实飞书 AS-2、双真实 Provider、Hermes
paired benchmark 和长期效果数据仍阻断 release tag。因而本增量不能单独把 `web-control-plane` 或整个项目升级为
`passed`/`released`。
