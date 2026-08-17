# AS-1 Hermes paired benchmark：Telegram 一次性审批

> 日期：2026-08-17；状态：一个确定性 paired slice 已通过，结果为平局；真实 Bot 冒烟仍未完成

## 冻结范围

本 epoch 只比较 Telegram 移动端审批按钮的身份与重放控制。两端执行同一序列：

1. 向 chat `1001` 发送一条“受保护生产动作”审批提示；
2. 错误 user `9999` 点击 `allow once`；
3. exact allowlist user `2002` 点击同一个 `allow once`；
4. 重放已经成功的 callback。

DSH 固定为 `47f943859bef60e4160492346772ded9b24f765a`，Hermes Agent 固定为
`29d0cc2602e01943ab300c0382fc9d97efb376da`。模型与公网均关闭；Telegram Bot API 只在传输边界
替换为内存桩。主要指标是“被错误身份或重放 callback 解析的受保护动作数”，越少越好。

冻结 manifest、runner、Hermes production-path fixture 和原始结果位于
`benchmarks/hermes-v0.1/as1-telegram-approval/`。复跑：

```sh
pnpm benchmark:hermes:as1
```

## 生产路径

EvoForge 侧直接使用 `dsh-telegram` 的 production `TelegramRuntime.requestApproval` 与
`handleUpdate`，保留真实 nonce、exact route identity、one-shot pending map 和 callback parser；只把
`sendText/answerCallback` 替换为记录型传输。

Hermes 侧直接实例化 production `TelegramAdapter`，调用 `send_exec_approval` 与
`_handle_callback_query`，保留 `TELEGRAM_ALLOWED_USERS` 授权检查、`_approval_state.pop` 和
`resolve_gateway_approval`；只替换 python-telegram-bot/httpx import 与 Bot send/edit/answer 传输。
fixture 没有复制或重写审批决策逻辑。

## 结果

| 指标 | DSH + EvoForge | Hermes |
|---|---:|---:|
| 提示发送到 exact chat | pass | pass |
| 错误身份解析动作 | **0** | **0** |
| exact 身份 `allow once` | 1 | 1 |
| 重放解析第二个动作 | **0** | **0** |
| 完成后 pending approval | 0 | 0 |

主指标为 `0:0`，两端 hard gate 全部通过。Hermes 会对错误身份和重放分别返回明确 toast；EvoForge
也会 acknowledge 已授权 route 内的重复 callback，但不会再次 resolve。这个差异不是本 epoch 的胜负
指标。本 epoch 支持的最窄结论是：

> 两端在确定性的 Telegram `allow once` 身份与重放控制上打平；没有证据支持任一方更优。

## 不支持的声明

内存传输不能证明真实 Bot token、移动网络、Telegram 服务端 redelivery、429、时延或长期在线可靠性；
本 epoch 也不比较普通消息、模型回答、Workspace 隔离、飞书或其他 Hermes 渠道。真实 Telegram/飞书
凭据冒烟与多日 paired soak 仍是 v0.1 未通过的门，不能用本报告替代。
