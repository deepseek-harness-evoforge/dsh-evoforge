# V5.30：Evolution Surface 真实 Workspace/Session 浏览器验收

- 日期：2026-08-26
- DSH revision：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- 状态：Evolution Surface 浏览器门 `verified`

## 验收环境

使用当前 `main` 已打包的十二个 EvoForge Bundle，安装到隔离 `DSH_HOME` 的官方 `web` profile，使用真实
WorkspaceRegistry、原生 Session/Agent、当前 `dsh-control-center` 和 `dsh-evolve-web`。测试 fixture 先写入一
个无模型调用的已完成原生 turn，使 DSH Web 能显示真实 Session；不伪造全局页面，也不调用外部 Provider。

## 结果

1. 浏览器进入真实 Workspace/Session 后，DSH 原生头部出现“对话 / 轨迹 / 控制台”三个 tab。
2. 点击“控制台”后显示 DSH 原生 `conversation.view` 内的 Control Center，并显示 Evolution Surface：
   “演化控制”、概览/Skills/高级 tab、权威状态说明和当前 Workspace 摘要。
3. 正常点击“刷新”成功读取 Host 权威 overview；页面没有固定弹窗、页面级横向溢出或独立侧栏入口。
4. 停止同一 Host 后点击“刷新”，页面显示可见的 Host 连接失败，同时保留“当前 Workspace”和上一份摘要，
   没有把故障误报成空数据。
5. 同一隔离 profile、同一端口恢复 Host 并重新加载页面后，Evolution Surface 重新读取并恢复正常；浏览器
   错误日志读取结果为空。

## 相关自动化

- `dsh-evolve-web` typecheck 通过；测试 `26/26` 通过。
- `dsh-control-center` 与 `dsh-evolve-web` 仍共用公共 Surface seam；fixture 已固定非空 Session 前置，避免
  DSH 原生隐藏 blank session 造成错误的“页面没有控制台”结论。

## 未由本证据覆盖

该门只证明迁移后的 Evolution Web Surface 在真实 DSH Workspace/Session 中可见、刷新、断连保留和恢复；不
证明真实 Provider、真实飞书完整 epoch-3、Doctor/Telegram 迁入公共 Surface、长期运行或 Hermes paired。

