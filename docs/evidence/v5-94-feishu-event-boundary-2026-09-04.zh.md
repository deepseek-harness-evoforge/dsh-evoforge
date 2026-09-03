# V5.94：飞书事件回调故障边界

## 发现

官方飞书平台适配器的 `message` 与 `cardAction` 监听器会调用异步处理器。处理器内部包含 Gateway 路由解析、
入站内容物化、Agent 投递和审批状态等多个 await；若其中任一步失败，直接把 Promise 返回给事件 emitter 会产生
未处理 rejection。对常驻 Gateway 来说，这会让故障既不稳定地传播到 SDK，也不能可靠地进入现有 transport 健康
投影。

## 修复

- `message` 和 `cardAction` 都通过 `receiveMessage`/`receiveApprovalAction` 边界调用原处理器。
- 边界捕获异常后，将已有 Feishu transport 标记为 `degraded`，记录最后错误时间，并通过已有 Gateway `report`
  投影；不记录消息、会话、发送者或凭据。
- 健康上报自身失败只写警告，不再次抛出；生命周期已经 abort 时丢弃迟到回调，避免 dispose 后复活状态。
- 没有新增 Gateway、Session、Goal、Agent Runtime、队列、重试、页面或第二套状态存储。

## 验证

开发和测试前重新 fetch DSH，确认官方最新远端 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；运行时支持基线仍为可构建 alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

```sh
DSH_DIR=<path-to-deepseek-harness>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
pnpm --filter dsh-feishu typecheck
pnpm --filter dsh-feishu exec vitest run test/runtime-dispose.test.ts --maxWorkers 1
pnpm --filter dsh-feishu build
git diff --check
```

结果：`dsh-feishu` 类型检查通过，teardown 定向测试 1/1 通过，产物构建通过。完整
`pnpm --filter dsh-feishu test` 当前为 45/46：已有
`native-schedule-restart.e2e.test.ts` 的 dispatch-durability 崩溃夹具在 alpha.5 下无法到达 `READY` 而超时。
在临时移除本修复后单独复现同一超时，证明它不是本增量引入；该失败保持可见，未用 skip 或重试伪造通过。

## 发布边界

这是常驻事件故障的 containment 与健康可观测性修复。真实 Feishu AS-2、两个独立 Provider、Hermes paired、长期
效果、真实浏览器恢复和首个 release tag 仍按根目录 `release-gates.json` 保持原状态；本证据不改变任何门禁。
