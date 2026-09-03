# V5.134：同 route id 重配与聊天类型变更回归

## 变更

配对装配回归进一步复用已撤销的同一 route id，并让重新配对后的消息以 `group` chat kind 入站。它验证撤销时清除内部 `observedChatKinds` 不是表面过滤：新 grant 不会继承旧 direct 事实，也不会触发错误的 chat-kind drift；Host `/feishu` 查询读取重配后的当前 route。

## 验证

在最新 DSH `origin/master` clean preflight 后，`dsh-feishu` typecheck、`dsh-gateway` 构建和配对装配回归 `1/1` 通过。原生 Session、撤销后 fail-closed 通知、重发配对码和同 route id 的 group 观测均得到断言。

该回归仍是本地装配证据，不代表真实 Feishu AS-2、Provider、Hermes paired、长期效果或 npm 发布门已通过。
