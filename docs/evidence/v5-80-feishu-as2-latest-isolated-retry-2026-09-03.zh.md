# V5.80：真实飞书 AS-2 最新隔离重试（2026-09-03）

## 运行身份

- 合同：`as2-feishu-resident-pairing-epoch-4`，仅 direct private chat；
- EvoForge：`e7ab932…`（run 启动时冻结的 `main` 提交）；
- DSH：`dsh-v0.1.2-alpha.5`，`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；
- App 身份只以脱敏 hash 记录，Secret 未写入报告、日志或仓库。

## 通过的前置观察

最终 `dsh-gateway`、`dsh-feishu`、轻量 `dsh-control-center` Bundle 安装到全新 profile，profile dump 成功，
官方 Feishu WebSocket 握手进入 `ready`。这证明当前凭据可建立官方长连接和插件 Host 组合，不证明事件订阅已生效。

## 严格结果

在 15 分钟人工窗口中，Gateway 没有读到一个与当前 App 身份匹配的 resident pending pairing request，终态为
`awaiting-resident-pairing-request` / `failed`。十三项观察中只有 `finalTarballsInstalled`、`profileDumped` 和
`officialTransportReady` 为真；`residentPairingGranted`、exact challenge、回复、Command、Schedule、Approval、
notice、重启免配对、卸载后 Session readback 均为假。runner 没有批准任何 principal，没有进入 DSH Agent，也没有
产生对外消息或其他副作用。

## 解释与边界

这是与 V5.74 同类但使用新隔离 run root 的独立失败，不能被合并成通过，也不能用来验证 V5.78/V5.79（该 run
启动于它们之前）。它把问题收敛在“事件没有抵达 Gateway pending pairing 层”，而不是把 WebSocket ready 当作
业务链路成功。可能原因仍包括飞书 App 的事件订阅/发布状态、测试账号与机器人私聊关系或平台投递延迟；本项目
不绕过平台权限、不从接口伪造事件、不自动向未知用户发送消息。

## 发布门

`real-feishu-as2` 继续为 `failed`。真实 Provider paired、Hermes 同条件 benchmark、长期负迁移/遗忘和完整
浏览器成功/失败/恢复门也未改变；不创建 release tag。下一次真实尝试必须使用新的隔离 run root，并在平台侧
确认 `im.message.receive_v1` 已发布、机器人已加入测试账号私聊后重新观察同一合同。
