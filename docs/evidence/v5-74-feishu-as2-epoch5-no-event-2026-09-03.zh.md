# V5.74：真实飞书 AS-2 epoch-5 事件到达失败证据（2026-09-03）

## 运行身份

本轮使用新的隔离 run root，未复用任何之前的终态或配对授权。EvoForge 固定在
`026a0e07a96c7a82cdbc30a301f5b99b3713f40c`，DSH 固定在可构建的
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`dsh-v0.1.2-alpha.5`）；App 身份只以脱敏 hash 记录。
Secret、chat id、user id 和临时目录不写入仓库。

## 已通过的前置阶段

- 由当前 main 的最终产物打包 `dsh-control-center`、`dsh-gateway`、`dsh-feishu` 三个 Bundle；边界检查拒绝
  Runtime、CLI 和嵌入式 `node_modules`。
- 在全新 DSH profile 中通过官方 CLI 安装三包，`--dump-config` 同时包含 Control Center、Gateway、Feishu
  pairing、原生 Schedule 和目标 Session。
- 常驻 Gateway 启动并连接官方 Feishu WebSocket，健康状态为 `ready`，单一 live Session、一个 ready
  transport、零 degraded transport。

## 严格失败

运行阶段保持 `awaiting-resident-pairing-request` 约 15 分钟，Gateway 没有观察到与当前 App 身份匹配的
唯一 pending pairing request。因而按 fail closed 退出，未执行也未声称完成以下步骤：

- resident pairing grant、陌生私聊进入原生 DSH Session；
- 原生回复、`/feishu` Command、Schedule round trip；
- Feishu Approval 卡片、Host notice、重启后继续收发；
- 官方卸载、Session readback 和卸载后 Host 启动。

最终观察值为：

```json
{
  "finalTarballsInstalled": true,
  "profileDumped": true,
  "officialTransportReady": true,
  "residentPairingGranted": false,
  "exactInboundChallenge": false,
  "replyDelivered": false,
  "commandRoundTrip": false,
  "nativeScheduleRoundTrip": false,
  "approvalAllowedOnce": false,
  "noticeDelivered": false,
  "postRestartRoundTrip": false,
  "sessionRecoveredAfterRemoval": false,
  "nativeHostBootedAfterRemoval": false
}
```

失败原因是 `resident Gateway did not expose the exact pending Feishu request`。这只说明本次人工窗口没有
事件到达，不足以区分用户未发送私聊、平台事件订阅/权限或网络投递问题；不得把 WebSocket ready 当作事件
链路已验证。没有批准 principal，也没有任何 Agent 或外部消息副作用。

## 发布门影响

本次结果替换此前运行的“等待事件”证据，`real-feishu-as2` 继续为 `failed`。下一次必须使用新的隔离 run
root，在事件确实到达后完成完整 direct message、Command、Schedule、Approval、notice、restart、remove
和 readback 纵切；不得重用本次非终态状态或伪造 pending request。该证据不影响已通过的本地兼容、clean-profile
和单页浏览器门，也不允许创建发布 tag。
