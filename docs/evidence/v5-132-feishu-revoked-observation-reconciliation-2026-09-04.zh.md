# V5.132：飞书撤销后的只读观测同步

## 变更

动态 Feishu pairing grant 撤销后，`observedChatKind(routeId)` 过去仍可能返回旧的 `direct/group` 观测。该 Host 只读 seam 现在与 routes、health、notify、inbound 一样先核对 Gateway 权威 route；已撤销 route 返回 `undefined`。静态配置 route 和原生 Session 生命周期不受影响。

## 验证

在最新 DSH `origin/master` clean preflight 后，完成 `dsh-feishu` typecheck、`dsh-gateway` 构建和配对装配回归：`1/1` 测试通过。回归覆盖撤销后 Host routes 清空、观测清空、通知拒绝、下一条私聊重新配对、原生 Session 继续工作和 `/feishu` 当前 route 查询。

本增量不改变真实 Feishu AS-2、真实 Provider、Hermes paired、长期效果或 npm 发布门状态。
