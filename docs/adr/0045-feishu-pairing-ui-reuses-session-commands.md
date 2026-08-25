# ADR-0045：飞书首次连接 UI 复用原生 Session Command

- 状态：superseded by [ADR-0098](0098-channel-pairing-is-a-resident-gateway-host-authority.md)
- 日期：2026-08-17

## 背景

setup-only `/feishu-pair` 已能从当前 DSH Workspace/Session 生成一次性短语和待审查的 exact route，
但要求新手发现并拼接三个命令仍有额外负担。DSH Web 已提供 Client Module、Session-scoped Commands
Remote、locale 与 sidebar slot；为配对再建立 EvoForge 网站、API 或状态服务会复制控制面和生命周期。

## 决定

`dsh-feishu` 的一个发布包同时包含 Host Bundle 与 browser half。Client Module 在原生
`sidebar.footer.action` 注册“连接飞书”，且只在当前 Session 的 Command descriptor 含
`feishu-pair` 时显示。向导只调用 `/feishu-pair start|status|cancel`：不新增 Host API、Remote、存储、
路由写入或后台轮询。页面的两分钟倒计时只是提示；Host 配对窗口、exact phrase、首条匹配和断开仍是
唯一权威。成功后页面只展示可复制、待人工审查的静态 YAML。

routes mode 沿用同一个约束：当前 Session descriptor 含 `/feishu` 时，原 slot 显示“飞书健康”。面板仅在
打开和人工刷新时执行 `/feishu`，解析 Host 生成的版本化 v1 健康投影；不建立新的 Remote 或轮询。
若部署中 setup-only 与 routes 实例同时存在，当前 Session 同时可见两个 Command，则已绑定的 `/feishu`
优先显示健康面，避免让已有 exact route 的用户再次进入配对。
投影只包含当前 Session 的非秘密 App account、route 名称/归属、官方 WebSocket lifecycle、持久出站
状态计数、最近投递的状态元数据与 pending Approval 数，不包含 App Secret、chat/user identity、消息
正文或模型内容。
transport error 会显示 `degraded`；后续真实收发活动才恢复 `ready`，浏览器失败不会改写 Host 状态。

Client build 以 DSH Module Loader wrapper 输出到 `dist/client.js`，React、Cordis 与 DSH client packages
保持 peer；Host 和 browser half 由同一次 `dsh plugin add/remove` 管理。测试 Workspace bootstrap 与
浏览器 overlay 留在 `test/fixtures`，不进入 tarball。

## 结果

- 新手可以在原 DSH Workspace/Session 内完成生成、复制、检查和取消，不必查平台 ID 或使用独立终端；
- Command 仍是无 Web 环境的备用入口，UI 与命令不会形成两套行为；
- 正常 routes mode 没有配对入口，普通 Session 的 Tool、Skill、Prompt 和模型 token 增量仍为 `0`；
- 正常 routes mode 有只读健康入口，复用 `/feishu` Command authority；读取失败保持可见并可人工刷新，
  但 Web 无 pause、重连、重试或清理 journal 的写权限；
- 页面不会自动写 profile 或授予 route，部署者仍须审查 YAML、退出 pairing mode 并重启 DSH；
- 真实浏览器验收必须从最终 tarball 的全新 profile 执行，并覆盖复制、取消、失败反馈和 console error。

## 拒绝方案

- 独立设置网站或 EvoForge Web server：形成第二产品表面与生命周期；
- 新建 pairing Remote/API：与已有 Session Command 重复且扩大接口；
- UI 后台轮询 `/feishu-pair status`：污染 Command 运行记录，并复制计时状态；
- 浏览器直接写 Router 配置：把部署权限交给 client，违反静态审查边界。
