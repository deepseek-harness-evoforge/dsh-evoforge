# V5.136：真实 Feishu AS-2 epoch-5 仍无新人 pending

## 执行与结果

本轮在 `dfdac55` 主线、已审计的 DSH alpha.5 支持基线
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 上，使用全新隔离 run root 和真实 App 身份运行
`as2-feishu-resident-pairing-epoch-4`。运行前再次 fetch 并确认 canonical DSH `origin/master`
`76fda729799fe9b3848dbe2c211d4b231032b81e`、版本 `0.1.2-rc.1`、工作树 clean；没有修改 DSH 源码。

运行器实际完成了：

- `dsh-control-center`、`dsh-gateway`、`dsh-feishu` 最终 tarball 打包；
- 全新 DSH `web` profile 安装和配置 dump；
- 常驻 Gateway 启动，官方 Feishu WebSocket 达到 `ready`。

在 `awaiting-resident-pairing-request` 的 5 分钟窗口内，未观察到当前 App 身份匹配的陌生私聊，因而没有
pending pairing request。runner 在任何配对、Agent 入站或平台回复前 fail closed，退出 `1`。

终态 observation：

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

没有批准 principal、没有进入 DSH Agent、没有发送回复/卡片/notice，也没有重启、卸载或其他平台副作用；
该非终态 run root 不复用。

## 判断

本轮证明干净安装、配置 dump 和官方 WebSocket ready 可执行，但仍不能证明真实飞书事件到达、resident
pairing、Session 投递、Schedule、Approval、重启恢复或卸载回读。原因只能记录为“测试账号在窗口内没有发送匹配的
陌生私聊”，不能据此归因 Loader、凭据或 Gateway 实现失败。`real-feishu-as2` 继续为 `failed`；下一次必须
使用新 run root，并让测试账号在 runner 提示后实际发送私聊。
