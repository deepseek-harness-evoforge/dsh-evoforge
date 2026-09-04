# V5.216：本轮真实浏览器复核被环境 URL policy 阻止

> 日期：2026-09-04。范围：记录本轮尝试复核 DSH 单页 Web 交互时的环境结果；不把失败的浏览器连接冒充为产品失败，也不把历史成功证据重复计为本轮通过。

## 事实

- in-app Browser 已成功连接，发现一个现有标签：`http://127.0.0.1:3080/`，标题为“无法访问此站点”。
- 按浏览器技能要求接管该用户标签后，读取页面 DOM 被 Browser URL policy 拒绝；拒绝发生在页面交互之前。
- 没有使用 raw CDP、独立 Playwright、Chrome 替代通道、URL 绕过或任何策略规避；已正常结束本轮浏览器会话。
- 因此本轮没有新增“点击/刷新/失败/恢复”通过结论，也没有修改 UI 代码或关闭用户标签。

## 可复用证据

仓库已有的真实单页证据仍保持有效，但属于各自记录的历史运行：

- [V5.183 单页 Control Center 浏览器验收](v5-183-single-page-control-center-browser-2026-09-04.zh.md)
- [V5.196 单页 Control Center live revalidation](v5-196-single-page-control-center-live-revalidation-2026-09-04.zh.md)
- [V5.100 鼠标命中区域与单页标签检查](v5-100-control-center-mouse-hit-target-2026-09-04.zh.md)

这些证据只能证明当时的 DSH/浏览器环境和页面状态；它们不能消除本轮环境 URL policy 阻塞，也不能替代
真实 Feishu/Telegram/Provider 或长期门禁。

## 后续边界

当允许访问本地 DSH URL 的浏览器环境可用时，应在同一个浏览器标签复验：原生 `conversation.view` 内的
Control Center tab 点击、刷新、远端失败快照保留、恢复、卸载以及标签数量仍为一。未完成该复验前，release
gate `web-control-plane` 继续保持 `partial`，不创建发布 tag。
