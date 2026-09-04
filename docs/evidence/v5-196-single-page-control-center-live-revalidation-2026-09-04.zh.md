# V5.196：DSH Web 单页控制中心交互复验（最新运行实例）

> 日期：2026-09-04。范围：在最新可构建 DSH 支持实例中，复验 EvoForge 控制中心是否真正嵌入原生 Session 页面，并记录渠道、内容与演化面板的可达性。此次验证不发送真实飞书消息、不写入外部服务。

## 结论

复验成功：只使用一个 `127.0.0.1:3080` 浏览器标签页，页面标题为 `DSH 本地构建`。EvoForge 控制中心出现在原生 Session 的“控制台”tab 中，使用 DSH 的 `conversation.view` 位置；没有第二个 Dashboard、弹窗遮挡、独立网站或额外 DSH Shell。

“设置”可以打开并关闭；关闭后控制中心的“运行诊断”“渠道”“飞书内容”“演化”四个 tab 均可点击并在同一页面切换。渠道页显示 Resident Gateway、连接状态、授权路由、持久入/出站计数和配对输入；飞书内容页显示内容权限提示与凭据轮换入口；演化页显示稳定状态、概览/Skills/高级子 tab。所有面板均标注“不调用模型”，与权威 Host 读取边界一致。

## 真实操作与结果

1. 复用现有浏览器会话，关闭不可用的旧错误页，只保留一个新标签页；未打开第二个测试网页。
2. 发现历史临时 profile 仍引用已不存在的旧 tarball 名称，启动失败并明确报 `dsh-feishu` 无法解析；没有修改 DSH 源码掩盖该问题。
3. 改用当前用户 profile 中已安装的 `dsh-evoforge-*` 包，以最新 DSH 支持 checkout 启动单个 Web Host。
4. 在同一 Session 页面打开“设置”，验证对话框可关闭；随后点击“渠道”，确认 `main "渠道与网关"`、`刷新状态`、`授权路由`、`渠道配对` 均出现在原生控制台内。
5. 点击“演化”和“飞书内容”，确认两个页面均能切换且保持同一 URL。演化 fixture 因未绑定原生 Workspace，显示 fail-closed 提示“请先打开一个属于原生 Workspace 的 Session”；这是真实边界提示，不被误记为通过。
6. 全程未点击“确认撤销”、未保存凭据、未发送消息，也未触发外部副作用。

## 版本与边界

- DSH 开发前已重新 fetch canonical `origin/master` `d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`）；其官方根构建仍被上游缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 阻断。
- 本次 Web 运行使用已审计且可构建的 alpha.5 支持 checkout；EvoForge 根 `pnpm run check` 保持 `CHECK_RC=0`。
- 该证据只证明单页布局、tab 切换、设置关闭和 fail-closed 提示可达；不扩大为真实 Feishu/Telegram、Provider、Hermes paired、长期运行或发布通过。
