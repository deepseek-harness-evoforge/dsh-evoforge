# ADR-0089：飞书 Approval 动作绑定 exact 卡片与 route

- 状态：accepted
- 日期：2026-08-21
- 关联：[ADR-0049](0049-channel-adapters-share-one-thin-dsh-gateway.md)、[ADR-0069](0069-channel-images-enter-dsh-as-native-attachments.md)
- 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 背景

DSH 原生 `approval/request` 是权限决定的唯一权威。飞书 Adapter 只把该请求投影为一次性卡片，不得持久化第二套 Approval、在 Gateway 中解释卡片，或让平台 action 绕过原生 waterfall。

旧实现用随机 nonce、chat 和 operator 匹配 action，但没有把 nonce 绑定到发送成功后飞书返回的 card message id，也没有沿 thread-scoped route 发送卡片。同一 chat 中来自其他卡片的伪造或过期 action 因而缺少最后一层平台对象绑定。

## 决策

1. Adapter 仍从当前 Agent 的 reply destination 或唯一静态 route 推导审批目的地；多 route 且无当前目的地时继续委托下一原生 Approval provider。
2. 卡片发送复用 exact message reply 与 `replyInThread` 选项。Gateway 不发送、解析或持久化平台卡片。
3. Adapter 只在卡片发送成功后登记 pending request，并保存官方 SDK 返回的 card message id。action 必须同时匹配合法 nonce、该 card message id、exact chat 和 exact operator。
4. 第一个完全匹配的 action 原子删除 pending request 后解析原生 `allowed-once` 或 `rejected`；错误卡片、错误 chat、错误 operator 和重复 action 均不改变状态。
5. request abort、Adapter dispose、disable、reload 和 remove 将 pending request 解析为 `cancelled`。卡片发送期间发生 dispose 或 abort 时不得在生命周期结束后重新登记。进程重启后的旧卡片没有 process-local pending request，因此保持失效。
6. 卡片发送失败继续委托原生 Approval waterfall。Adapter 不增加重试 worker、Approval Store、超时裁决或权限策略。

## 后果

- 权限决定继续由 DSH Agent/Approval lifecycle 持有；飞书只提供精确、一次性的交互表面。
- thread-scoped 群聊中的 Approval、普通回复与 Goal/Schedule continuation 保持同一 exact route。
- pending 计数仍是脱敏健康事实，不暴露 nonce、card message id、chat、operator、工具参数或原因。
- 自动化装配证明不等于真实飞书用户点击、真实 App 权限、重连或多日运行验收。
