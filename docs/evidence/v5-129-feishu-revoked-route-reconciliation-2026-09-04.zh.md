# V5.129：飞书动态配对撤销后的路由权威同步

## 发现

`dsh-feishu` 在运行时维护 `routesById`/`routesBySession` 缓存。Gateway Host 撤销动态配对授权后，Gateway 已不再返回该 route，但 Feishu 缓存仍可能把它展示在 Host 控制面、用于健康快照或接受 Host 通知。这会让“撤销”与实际 Adapter 行为不一致。

## 修复

动态配对模式现在在 Host `routes` 读取、健康快照、Host 通知和入站消息前，以 `gateway.route(routeId)` 作为唯一权威状态；已撤销的非配置 route 会被移除并重建 Session 索引。静态配置 route 不受影响，DSH 原生 Agent/Session 不会因撤销而被删除。撤销后旧 route 不再接收通知，下一条陌生私聊仍由常驻 Gateway 发出新配对码。

## 验证

在最新 DSH `origin/master` `76fda729799fe9b3848dbe2c211d4b231032b81e` clean preflight 后，构建 `dsh-gateway` 并运行：

```text
pnpm --filter dsh-gateway build
pnpm --filter dsh-feishu exec vitest run test/pairing-assembled.e2e.test.ts --maxWorkers=1 --reporter=verbose
```

装配回归 `1/1` 通过，覆盖首次陌生 DM 发码、Host 批准、原生 Session 入站、撤销后控制面清空/通知拒绝、重新发码和重新进入同一 Session。测试先等待 outbound journal 进入终态，避免把正在发送的真实副作用误当作可撤销。

完整 Feishu 套件此前的独立失败仍需按其自身前置构建要求执行；本增量没有修改 DSH 上游，也没有宣称真实飞书 AS-2、双 Provider 或 Hermes paired 已通过。
