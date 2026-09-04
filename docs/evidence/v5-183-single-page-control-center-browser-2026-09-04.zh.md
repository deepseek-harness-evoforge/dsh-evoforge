# V5.183：DSH 原生单页控制中心真实浏览器复验

> 日期：2026-09-04。范围：验证控制中心是否真正嵌入 DSH 会话页面，以及渠道健康界面的真实交互可达性。

## 结论

在已审计的 DSH alpha.5 支持 checkout 上启动一个 Web Host 后，浏览器只打开一个
`127.0.0.1:3080` 页面。进入既有 Session 的原生“控制台”tab 后，EvoForge Control Center 作为
`conversation.view` 内的同页控制面渲染；没有第二个网页、独立 Dashboard、固定遮挡式配对弹窗或
重复的 DSH Shell。

控制中心内的“运行诊断”和“渠道”子 tab 可以互相切换；渠道页显示 Resident Gateway 摘要、持久入/出站计数、
传输与授权路由。刷新状态会更新同一页面的权威读取时间；授权路由的第一次点击进入“确认撤销”状态而不产生
外部副作用，说明操作按钮可达且有二次确认。随后重新加载同一 URL，页面恢复到原生 Session 的控制台和诊断 tab。

## 真实操作记录

1. 启动 DSH Web：`node /private/tmp/evoforge-dsh-latest.qPqo1d/apps/cli/lib/bin.js --profile web --no-open`；Host 打印
   `http://127.0.0.1:3080/?token=…`，使用现有用户 profile，不创建第二个 Host。
2. 单页等待加载后，DOM 只出现一个 DSH 页面；选择既有 `Control Center browser fixture.` Session。
3. 点击原生 Session `控制台` tab，观察到 `complementary "控制中心"`、`tablist` 和 `tabpanel "运行诊断"`。
4. 点击控制中心 `渠道` tab，观察到 `main "渠道与网关"`、`刷新状态`、`授权路由` 及渠道健康状态。
5. 点击 `刷新状态`，页面仍停留在同一 tab，读取时间更新。
6. 点击授权路由的 `撤销授权`，按钮变为 `确认撤销 …`；未点击确认，不修改持久授权。
7. 重新加载同一 URL，控制中心和 Session 恢复，未打开新页面；随后点击 `重新诊断`，仍留在同一页面。
8. `browser.tabs.list()` 最终只返回一个页面：标题 `Control Center browser fixture. — DSH 本地构建`。

## 版本与边界

- 本轮浏览器前重新 fetch canonical DSH，`HEAD == origin/master == 76fda729799fe9b3848dbe2c211d4b231032b81e`，描述为
  `dsh-v0.1.2-rc.1-99-g76fda72979`；运行使用已审计可构建 checkout `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- 这次验证证明单页布局、tab 切换、刷新、二次确认和重载恢复的真实浏览器可达性；没有把截图或 DOM 复验扩大为真实
  Feishu/Telegram 外部消息、Provider、Hermes paired 或长期运行通过。
- 测试结束后已关闭 DSH Web 进程并清理浏览器页面；未留下常驻测试服务。
