# V5.23：AS-2 改为 resident pairing 真实渠道门

- 日期：2026-08-25
- DSH：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- 状态：epoch-3 入口 implemented；完整真实执行仍为 `NOT_RUN`

## 纠正对象

V5.21 的 AS-2 runner 仍要求启动前提供 `conversationId`、`userId` 和 `chatKind`，并把 exact 飞书 endpoint
写成静态 Gateway route。这与 V5.22 已上线的 resident pairing 产品流程冲突，也会把“先查平台 ID、再启动
专用 workflow”重新带回验收路径。

epoch-3 `as2-feishu-resident-pairing-epoch-3` 删除这三个启动输入。最终 Gateway/Feishu tarball 以零预授权
飞书 route 启动官方 WebSocket；benchmark-only seed route 只创建可由 Host 选择的原生 Workspace/Session，
不授权任何飞书身份。真实用户先发送任意私聊，首条消息必须只产生短期 code 且不进入 Agent；Host 从终端
输入 code 并调用生产 `approvePairingForSession()`，动态 grant 才成为 exact route。公开报告只在批准后保留
principal tuple 的 SHA-256，不输出 conversation、user 或 code。

## 关闭门

epoch-3 要求十三项 observation 全真：最终包安装、profile dump、零 route transport ready、resident grant、
exact challenge 入站/回复、`/feishu`、官方 `schedule_create` 的 create→dispatch→插件来源 `user/message`、
原生 Approval `allowed-once`、动态 Host route notice、Host 干净重启后无需重新配对的新增消息/回复、卸载后
Session readback，以及无插件原生 Host 启动。Gateway ingress/outbound 的 uncertain/failed 继续阻断通过。

本 epoch 只接受 `direct`。未知 group 继续静默，群聊身份、mention/thread policy 与平台效果必须另设真实门，
不得用 direct 结果冒充。

## 同增量产品修复

审计 runner 时发现 pairing mode 未向 Host 提供 `evoforge.feishuRoute`：动态 route 虽能回复和发送 Approval，
但进化待办等主动 notice 无法发现它。`dsh-feishu` 现在为 routes/pairing 两种模式提供同一 Host seam；`routes`
是每次读取时形成的当前 grant 快照。assembled DSH 证明初始为空、动态 grant 被第二条消息采用后出现，并在
同一 route 完成原生 Approval `allowed-once` 和持久 notice。该 seam 不暴露外部 principal id，也不创建 Gateway
业务、Session 或 Approval 权威。

## 检查

- `pnpm --filter dsh-feishu test -- pairing-assembled.e2e.test.ts`：17 files / 44 tests passed；
- `pnpm --filter dsh-feishu typecheck`：通过；
- `pnpm benchmark:feishu:as2:check`：epoch-3 contract 9/9 与独立严格类型检查通过；
- 未设置精确真实效果授权时，runner 只读授权变量、输出 `NOT_RUN` 并以 exit 2 退出。

## 未证明

本页没有启动第二条真实 App WebSocket，也没有完成 epoch-3 的人工 Schedule、Approval 点击、Host 重启消息、
卸载/readback 全链。因此它证明当前最终包已有正确验收入口和 assembled 产品行为，不是新的真实平台 `passed`
报告。现有 V5.22 三轮真实消息与重启状态恢复证据继续独立成立。
