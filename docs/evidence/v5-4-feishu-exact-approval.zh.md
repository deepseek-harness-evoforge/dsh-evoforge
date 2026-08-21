# V5.4 飞书 exact Approval 卡片闭环

> 日期：2026-08-21；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；状态：assembled verified；真实飞书用户点击仍 pending

## 本增量修正

飞书 Adapter 以前只用 nonce、chat 和 operator 匹配原生 DSH Approval action，没有绑定实际发送成功的 card message id，也没有把 Approval 卡片送入 thread-scoped exact route。本增量按 [ADR-0089](../adr/0089-feishu-approval-actions-bind-the-exact-card-and-route.md) 收紧为 nonce + card message id + chat + operator 四项同时匹配，并保持首次成功动作的一次性消费。

卡片发送继续属于 `dsh-feishu` 平台边界；`dsh-gateway` 没有增加 card 类型、Approval 状态、凭据或平台 SDK。发送失败仍委托 DSH 原生 Approval waterfall，abort/dispose 将 pending request 解析为 `cancelled`，生命周期结束后旧 action 没有可消费状态。

## 已执行证据

`dsh-assembled-chat.e2e.test.ts` 通过真实 DSH Boot、WorkspaceRegistry、Session persistence、Agent Loop、Commands、AttachmentStore、Gateway 和飞书 Adapter 装配一条 thread-scoped group route；只替换外部飞书网络传输和非确定性模型响应。该路径证明：

- 普通回复沿 source message + exact thread 发送；Goal/Schedule continuation 沿 exact thread 主动投递；
- `approval/request` 生成卡片并携带 `replyInThread`；
- 其他 card message id 不能消费请求，错误 operator 不能消费请求；
- exact card/chat/operator 的首个 action 返回 `allowed-once`，重放不改变 pending 状态；
- Adapter dispose 将第二个未完成的原生 Approval 解析为 `cancelled` 并断开平台。

test-first RED 首先停在 Approval 卡片缺少 `replyInThread`；实现后 focused assembled test 通过。完整 `dsh-feishu` 回归为 `14/14` test files、`34/34` tests，通过包级 typecheck/build；根级 `pnpm check` 同步通过文档、十一包 typecheck、全部测试和全部构建。

## 未完成声明

本证据不冒充真实飞书 App 的 exact 用户消息、真实卡片点击、权限拒绝、WebSocket 重连或多日运行，也不完成普通文件/音视频、文档、知识库、云盘、多维表格的独立权限能力。它只完成可重复的 DSH assembled Approval 精确绑定门。
