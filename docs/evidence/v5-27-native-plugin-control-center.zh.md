# V5.27：DSH 原生插件 Control Center

- 日期：2026-08-26
- DSH revision：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- 范围：通用插件可视化 seam、Gateway/飞书迁移、十二包安装与真实浏览器故障恢复
- 状态：当前纵切已验证；Evolution 等复杂 Surface 迁移仍 pending

## 用户可见问题

Gateway 和飞书各自在 `sidebar.footer.action` 中打开 `position: fixed` 面板。它们遮挡 DSH、复制页面壳，
插件越多入口和弹层越多；同一个“飞书健康”还混合消息连接、投递与 Session-scoped 内容 Tool，用户无法判断
应该在哪里处理问题。该形态即使功能可点，也不是可扩展的插件控制面。

## 固定调研事实

[设计调研](../research/plugin-visualization-reference-2026-08-25.zh.md)固定并区分以下一手 revision：

- DSH `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `dsh-v0.1.1-rc.2`；
- Turtle UI `b08ed69`；
- Hermes `1bbb6e5`；
- HanaAgent/openhanako `1d3ef30` / `v0.450.0`。

DSH 已有原生 `conversation.view` 和 Cordis slot ledger，不需要 EvoForge 自造 Router。Hermes、HanaAgent 与
DSH TUI 可复用的是稳定主区、层级化信息、异常优先和技术细节渐进披露，不是照搬其 Runtime 或产品外壳。

## 实现

1. 新增可独立安装、启停和卸载的第十二包 `dsh-control-center`；Host 入口为空操作，Client 只注册一个
   `conversation.view`“控制台”；
2. Control Center 声明 `evoforge.control.surface` child slot，并把 Surface/Header/Status/Metrics/Section/
   Entity/Notice/Button/Empty/Loading 作为 owner props 传给贡献者；DSH Slot 是唯一 registry；
3. `dsh-gateway` 改为 Gateway Surface：显示授权渠道、实时 Session、入站/出站、异常、常驻 transport、
   动态 grant、配对批准与安全撤销；内部 route id 默认折叠；
4. `dsh-feishu` 改为“飞书内容”Surface，只说明当前 Session 的 document/Wiki/Drive/Bitable Tool 与 Approval；
   消息连接和投递明确引导到“渠道”；
5. 删除 Gateway/飞书各自的 fixed-dialog CSS；两个插件均不再注册 sidebar footer action；
6. 首次从长对话切换到控制台时主动回到 Surface 顶部；Host 读取失败保留最后成功快照并显式报错，恢复后
   刷新重新读取；Remote 原始错误不直接暴露到主界面。

以上边界由 [ADR-0099](../adr/0099-control-center-owns-one-native-view-and-child-surface-slot.md) 固定。

## 自动化门

- `dsh-control-center`：typecheck；2 files / 4 tests passed；
- `dsh-gateway`：typecheck；定向 2 files / 5 tests passed；
- `dsh-feishu`：typecheck；定向 2 files / 6 tests passed；
- Doctor native suite contract：24 tests passed；
- 当前十二包 clean-profile tarball add/dump/boot/真实 Session+Goal+Tool/remove/reboot/readback：1/1 passed；
- frozen predecessor 十一包→当前十二包官方 CLI 升级、旧 Gap/Goal/Session readback、新 Opportunity、卸载：
  1/1 passed（65.68 秒）；
- 根级 `pnpm check`：文档、双 RC compatibility script、RP-1 8/8、AS-2 9/9、全部十二包
  typecheck/test/build 通过；Gateway 8 files / 32 tests、Feishu 18 files / 45 tests。

## 真实浏览器

从当前源构建最终 `dsh-control-center`、`dsh-gateway`、`dsh-feishu` tarball，经 DSH 官方
`plugin --profile web add` 安装进真实 `web` profile，常驻入口为 `http://127.0.0.1:3080/`。真实 Chrome
选择既有 Session 后出现 DSH 原生“对话 / 轨迹 / 控制台”三标签；首次从滚动到底部的长对话切换到控制台：

- document scrollTop 为 0，Control Center root 位于原生头部下方；
- 1440 px 视口 document width 与 viewport width 同为 1440，无页面级横向溢出；
- 页面显示 1 条授权渠道、1 个实时 Session、3 条入站、3 条出站、0 个异常；
- `official-feishu-websocket` 为“连接正常”，动态授权与配对操作仍在；
- “飞书内容”在无 `/feishu` Tool 的旧 Session 中明确显示“当前对话未启用飞书内容读取”，不误报消息断连；
- 正常路径没有 page error 或 console error。

故障注入时停止同一个 DSH Host，再点击“刷新状态”：页面显示“暂时无法连接 DSH Host。已保留上一次成功
状态，请稍后刷新”，同时继续保留 transport、route 和 3/3 指标，避免失去诊断上下文；恢复同 profile、
同端口 Host 后再次刷新，错误消失且连接恢复正常。
注入窗口的浏览器 console 只出现预期的 HTTP/WebSocket connection refused，恢复后没有残留应用错误。

## 边界

- Control Center 是 DSH Client 组合视图，不是独立服务、数据库、网站、Router 或状态权威；
- 本纵切没有修改 DSH、Session、Goal、Agent Runtime、Approval、Gateway 配对或飞书凭据契约；
- `dsh-evolve-web` 的复杂审查/晋升/回滚面尚未迁入公共 Surface；Doctor/Telegram 也仍待按真实需求增量接入；
- 无 Session 时当前 DSH 没有正式的全局 `conversation.view`，本项目不绕过官方 seam 自造全局页；
- 该 UI 纵切不等于真实 AS-2、长期渠道运行或 Hermes 整体上位替代已经完成。
