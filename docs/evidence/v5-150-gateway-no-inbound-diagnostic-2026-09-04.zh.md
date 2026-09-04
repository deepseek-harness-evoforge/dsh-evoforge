# V5.150：Gateway 单页明确显示“连接正常但尚无入站事件”

日期：2026-09-04  
EvoForge revision：`e645af62417c4901ed441e967cee8a4f21e9ec59`
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，clean。

## 问题

真实 Feishu AS-2 已证明 App Secret、最终 Bundle、profile dump 和官方 WebSocket handshake 可以全部成功，但在
没有任何平台入站事件时，Gateway 单页只呈现绿色 `ready`，用户无法区分“连接已建立”与“消息事件已抵达”。这会把
事件订阅、机器人启用、长连接或测试账号关系问题误判为 DSH Agent 没有反应。

## 修复

Gateway Control Surface 现在对每个 `ready` 且 `lastInboundAt` 为空的 Adapter 显示无模型、无副作用的 attention notice，
明确提示检查机器人启用、事件订阅和长连接配置；首次真实入站事件被 Host 记录后该提示自然消失。通知复用现有
`conversation.view` 和 Control Center `Notice` 原语，不新增网页、轮询、Router、状态库或模型调用，内部 Adapter 名称
仍按当前 Gateway transport 投影生成。

## 验证

开发前重新 fetch 并核对 canonical DSH：`76fda729…`、`0.1.2-rc.1`、clean。随后执行：

```sh
pnpm --filter dsh-gateway test
pnpm --filter dsh-gateway typecheck
pnpm --filter dsh-gateway build
```

Gateway 全部 `41/41` 测试、测试类型检查和 Host/Client 构建均通过；已有“连接 ready 但无 `lastInboundAt`”的真实
新连接 Journey 回归现在同时断言该诊断文字。该修复不改变真实渠道门禁状态，也不把没有事件的运行宣称为成功。
