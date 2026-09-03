# V5.133：撤销配对时清除飞书内部观测

## 变更

撤销动态 Feishu route 时，Runtime 现在同时删除该 route 的内部 `observedChatKinds` 记录。这样同一 route id 后续若被重新配对，新的 direct/group 事实不会与上一次已撤销 grant 发生漂移冲突；对外的 `observedChatKind` 仍以当前 Gateway route 存在性为准。

## 验证

在最新 DSH `origin/master` clean preflight 后，`dsh-feishu` typecheck、`dsh-gateway` 构建和配对装配回归 `1/1` 通过。回归继续覆盖撤销后 routes/观测清空、通知拒绝、重新配对和 Session `/feishu` 当前 route 查询。

该修复只清除撤销 grant 的内存观测，不删除 DSH 原生 Agent/Session，也不改变真实 Feishu AS-2、Provider、Hermes paired、长期效果或 npm 发布门。
