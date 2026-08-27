# V5.59：新 Gateway 包原位安装与单页控制面复验

## 目的

验证 V5.57 的待批准请求控制面已经进入可运行的 DSH profile，而不是只存在于源码和单测中；同时确认
常驻 Gateway、Feishu Adapter 与原生 DSH Web 控制中心仍保持单 Host、单页面和可恢复的交互边界。

## 实际操作

- 在当前 `web` profile 停止旧 Host，备份 profile `package.json`，用官方 DSH CLI 将新构建的
  `dsh-gateway` tarball 原位安装；没有创建第二个 profile、Git 分支或浏览器页面。
- 安装后的 profile dump 显示 `dsh-gateway` 为启用状态且没有额外 route；Remote artifact 已包含
  `pendingPairings` 与 `approvePairingRequest` 两个新方法。
- 首次不提供 Feishu 凭据时，Host 按预期 fail closed，明确报告配置的环境变量为空；随后仅在进程环境中
  注入用户授权的 Feishu 凭据启动，凭据未写入仓库、profile 或证据文件。
- Host 以 `--profile web --no-open --port 3080` 常驻运行，只监听 `127.0.0.1:3080`。

## 单页浏览器验证

使用同一个原生 DSH Session 的同一个 `127.0.0.1:3080` 页面完成：

1. 点击 `控制台` 后进入公共 `渠道` Surface；未出现固定悬浮窗口或第二个端口页面。
2. 页面显示 `渠道与网关`、`飞书` 连接正常、授权路由、`待批准请求` 和 `飞书配对`；当前没有陌生私聊时，待批准区权威显示“没有待批准请求”。
3. 点击 `刷新状态` 后仍停留在同一 URL，以上区域继续存在；状态读取失败时的“保留最后成功快照”路径由自动化契约覆盖。
4. 浏览器 console 的 `warn/error` 为空。

## 结论与边界

本证据证明新 Remote 已装入现有 profile，常驻 Host 可在单页面控制面展示待批准请求入口，并且刷新/恢复
不再打开额外页面。它不证明真实 Feishu 陌生私聊已经重新跑通：当前发布门仍记录最近一次真实 epoch-3
配对码等待超时；真实 Provider、完整 Hermes paired benchmark 和长期效果数据也仍未达标。
