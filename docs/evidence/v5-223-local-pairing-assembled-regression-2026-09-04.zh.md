# V5.223：Feishu/Telegram 常驻配对闭环回归（本轮）

## 范围

本轮只验证本地可重复的 DSH assembled profile，不读取真实凭据、不连接真实平台、不发送外部消息。测试使用已审计的 DSH 支持组合，并从当前 `main` 构建两个 Adapter。

## 执行与结果

```text
pnpm --filter dsh-evoforge-feishu exec vitest run test/pairing-assembled.e2e.test.ts --maxWorkers 1
Test Files 1 passed; Tests 1 passed; exit 0

pnpm --filter dsh-evoforge-telegram exec vitest run test/pairing-assembled.e2e.test.ts --maxWorkers 1
Test Files 1 passed; Tests 1 passed; exit 0
```

Feishu 与 Telegram 两条路径均覆盖：常驻 Gateway 保持连接；陌生私聊首条消息只返回一次配对码且不进入 Agent；Host 使用配对码批准后，下一条消息才映射到 DSH Session；路由健康状态变为 `paired`。Feishu fixture 还覆盖 Host notice、Approval 回送和撤销后的 fail-closed 行为；Telegram fixture 覆盖 reply-to 与 Bot API 出站记录。

## 不能外推的结论

这不是真实 Feishu/Telegram 验收，也不是 Hermes paired benchmark。真实 AS-2/AS-1 仍需要同一任务、同一模型和同一权限下的外部消息、重启/卸载、持久回读证据；发布门禁继续保持 blocked。

