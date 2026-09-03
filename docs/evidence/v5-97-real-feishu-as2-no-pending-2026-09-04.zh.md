# V5.97：真实 Feishu AS-2 最新隔离重试严格失败

## 运行身份

- EvoForge：`d6b9e56b14ef4a7b7b7ae51a830598ffead14bd7`（启动运行时的 clean main 快照）；
- DSH：`0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；
- Benchmark：`as2-feishu-resident-pairing-epoch-4`，全新隔离 run root；
- App 公开报告只保留 `appIdentityHash`，不记录 App ID、Secret、聊天、用户或配对码。

## 执行与结果

运行器在真实效果前完成最终 `dsh-control-center`、`dsh-gateway`、`dsh-feishu` Bundle 打包，安装到干净
DSH `web` profile 并完成配置 dump。Host 随后以零预授权 Feishu route 常驻，官方 WebSocket 达到 `ready`。
在规范 15 分钟人工窗口内，没有观察到当前 App 身份匹配的陌生私聊，因此 Host 没有产生 pending pairing
request；运行器在 `awaiting-resident-pairing-request` 阶段严格 fail closed。

终态观察值：

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

运行器报告 `status: failed`、原因 `resident Gateway did not expose the exact pending Feishu request`。没有批准
principal、没有进入 DSH Agent、没有发送回复/卡片/notice，也没有任何其他平台副作用；该非终态 run root 不复用。

## 结论与边界

这次结果证明常驻 Host 和官方 WebSocket 启动路径可执行，但不能证明真实飞书事件到达、配对、Session 投递、
Schedule、Approval、重启恢复或卸载。`release-gates.json` 的 `real-feishu-as2` 继续为 `failed`；必须在全新
隔离 run root 中观察到当前 App 的真实陌生私聊并完成完整 epoch 后才可更新门禁。
