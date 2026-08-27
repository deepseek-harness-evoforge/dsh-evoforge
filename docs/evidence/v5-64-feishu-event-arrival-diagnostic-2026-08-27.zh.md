# V5.64：真实飞书事件到达诊断

## 观察

新的 AS-2 隔离 run 在当前 DSH revision 上完成了最终 tarball 安装、profile dump 和官方 WebSocket handshake，
Gateway health 达到 `ready`；随后在完整人工窗口内没有观察到任何 Feishu pending request，因而安全停在
`awaiting-resident-pairing-request`，没有进入 Agent、没有发送挑战消息，也没有写入动态 route。

## 只读平台检查

- 使用用户授权的 App 凭据获取 tenant token 成功。
- Feishu Bot info 返回 HTTP 200、`code=0`，机器人 `app_name` 为 `DSH`、`activate_status=2`；凭据和身份值未写入
  仓库或报告。
- 事件订阅读取接口返回 Feishu `Access denied`，因为该 App 未开通 `event:subscription:read`；本诊断没有
  修改权限或订阅。该 scope 不是 Gateway 运行必需 scope，但缺少它无法从 API 侧证明
  `im.message.receive_v1` 是否已在开发者后台开启。

## 结论与下一步

代码侧“常驻连接 ready”与“陌生私聊事件进入 pending”已经被验收器严格区分；当前失败不能归因于配对审批、
Session 或 Agent。要完成 AS-2，需要在飞书开发者后台确认机器人已启用 `im.message.receive_v1` 长连接事件，
并由测试账号向该机器人发送一条新的私聊；收到后同一 Host 会自动按 request-id 审批并继续完整纵切。

本证据不改变发布门：没有真实事件、消息、Schedule、Approval、重启、卸载和 Session readback 的 terminal
passed 报告，`real-feishu-as2` 仍为 `failed`。
