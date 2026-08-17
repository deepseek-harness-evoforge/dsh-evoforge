# AS-2 飞书 Channel Adapter 实现证据

> 日期：2026-08-17；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；状态：implemented，尚未完成真实 App 冒烟或 Hermes paired benchmark

`dsh-feishu` 是 `dsh-channel-router` 上的第二个薄 Adapter，不是独立机器人 Runtime。它使用飞书官方 Node SDK `1.73.0` 的 WebSocket 长连接；Router 持有 endpoint → Workspace/Session/Agent、原生 Command admission 和 ingress 幂等，Adapter 只持有协议、Approval 卡片与出站 journal。

## 已执行链路

- 真实 DSH Boot、WorkspaceRegistry、Agent preset、Session persistence、Agent Loop 和 cli-mock provider；
- 未授权 user 无 Session 输入或平台回复；授权文本生成 `channel:<sha256>` 原生 User Message，并把最终 Assistant answer 回复到 exact chat/message；
- `/feishu` 只执行一次原生 Command；原生 Goal/Schedule continuation 在单 route Session 主动投递；
- DSH `approval/request` 生成一次性飞书卡片 nonce，只有 exact chat/operator 的首个 action 可返回 `allowed-once`/`rejected`；
- 发送意图先写 `evoforge_feishu` StorageDomain；明确 rate-limit 先记录 `sending`，有界重试后 `delivered`；传输模糊失败和 crash-recovered `sending` 均为 `uncertain`；
- Cordis dispose 注销平台 handler、取消 pending Approval、停止 worker、关闭 domain 并断开连接；
- packed `dsh-channel-router` + `dsh-feishu` 通过干净 profile 的官方 add、dump-config、官方 SDK 依赖解析与 remove。

联合门禁还在**同一个真实 DSH Host** 中注册两个真实目录为两个 Workspace，加载实际 Router、Telegram Bundle 与飞书 runtime：Telegram 与飞书分别创建 `telegram-session`/`feishu-session`，其原生 `session.header.cwd`、WorkspaceRegistry `sessionIds`、User Message、Command、Approval 和 continuation 全部保持分离；错误飞书 operator 不能消费另一个 Workspace 的 Approval。Host dispose 后以同一 persistence/StorageDomain/config 冷启动，两个 Agent 各自恢复，重放同一 Telegram update 和飞书 message 不新增 turn 或对外投递。另一条完整 composition 门同时启用 Router、Telegram、飞书与 evolution attention，将两个 Workspace 的 provider request 分别与原生双 Agent 控制组逐字段比较，结果均 byte-equivalent；route、App 与 attention 动态值未进入请求。

当前包回归为 `9 files / 20 tests`（包含单渠道、双 Workspace macOS assembled、完整渠道 composition 与 package lifecycle）；Router 的独立合同与 Telegram cache parity 继续通过。官方协议依据是[事件订阅概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)、[官方 Node SDK](https://github.com/larksuite/node-sdk)与[发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。

## 尚未证明

- 尚未使用用户提供的真实 App ID/Secret、真实 `im.message.receive_v1` 或卡片 action；
- 尚未测多日自动重连、真实移动端延迟、飞书权限撤销和 Hermes 同场景 paired outcome；
- 因此只能声明第二 Adapter 已实现，不能声明生产可用或已经上位 Hermes。
