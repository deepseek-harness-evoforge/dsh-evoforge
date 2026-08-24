# V5.18：原生 DSH Schedule 到飞书回送

## 用户结果

对已经绑定一个 exact 飞书 route 的原生 DSH Session，用户创建的 DSH session-local reminder 到期后，会进入
同一个 Agent 的普通 follow-up 队列，并通过既有 `dsh-gateway` durable outbound 与 `dsh-feishu` Adapter 回送到
同一线程。EvoForge 不增加 Schedule service、timer、数据库、Tool 或第二调度器。

## 被推翻的旧证据

原 assembled chat 测试直接调用 `agent.followup()`，并把用户文本写成
`native Goal or Schedule continuation`。它只能证明普通原生 continuation，不证明 Schedule 插件已加载、
`schedule_create` 可用、Schedule durable event 已形成或到期消息确由官方 runtime 派发。

红灯阶段删除这段手工 follow-up，改为调用 agent-scoped `schedule_create`；未加载官方 Schedule 时，测试按预期失败：

```text
AssertionError: expected undefined to be defined
ctx.tools.get('schedule_create', agent) === undefined
```

## 真实组合路径

`packages/dsh-feishu/test/dsh-assembled-chat.e2e.test.ts` 现在：

1. 在真实 DSH Host composition 中加载官方 `@deepseek-ai/dsh-schedule` 源码构建产物；
2. 由 Gateway 解析 exact Workspace/Session/Agent，Feishu Adapter 绑定同一 route；
3. 通过真实 `ctx.tools.execute()`、exact Agent initiator 和 `schedule_create` 创建一秒后到期的 reminder；
4. 断言原生 Session 各有一条 `schedule/change create` 与 `dispatch`，到期 `user/message` 的 source 是
   `plugin:schedule`；
5. 让 DSH Agent 正常执行该 follow-up，并断言 Gateway 持久 `turn` intent 只出现一条、等待 exact
   `turn/end`、最终为 `delivered` 且 attempts 为 1；
6. 断言飞书出站保留 exact thread scope，但不伪造入站消息 reply id。

这条路径复用 DSH Session、Agent、Tool registry、Schedule runtime 与 Gateway journal。它没有模型表面新增、
没有运行时能力获取，也没有 Feishu/Gateway 私有 Schedule 状态。

## 验证

定向红灯与绿灯命令相同：

```sh
pnpm --filter dsh-feishu exec vitest run test/dsh-assembled-chat.e2e.test.ts --maxWorkers 1
```

- 红灯：`1 failed`，原因是官方 Schedule 尚未进入 assembled composition；
- 绿灯：`1 passed`，真实 Schedule create→dispatch→follow-up→turn/end→Gateway journal→Feishu thread 路径通过。

随后执行：

```sh
pnpm --filter dsh-feishu run typecheck
pnpm --filter dsh-feishu test
pnpm check
```

- `dsh-feishu`：`17 files / 49 tests passed`；
- 根级：文档、rc.5/rc.2 兼容合同、Hermes EV-1 类型门、RP-1 `8/8` 零调用合同、AS-2 `7/7`
  零调用合同、全部 typecheck、`568 passed / 3 skipped` 和全部 build 通过；
- 首轮全仓并发运行曾在平台 send 已完成、Gateway journal 尚处 `sending` 的短窗口过早读取；断言改为等待
  Host 权威 `delivered` 终态后，飞书全包与完整根门均通过。测试不把 Adapter 的先行内存记录冒充 durable 结果。

## 边界

本增量是 keyless assembled DSH 证据，不是生产飞书 App、真实用户点击、真实 Provider、重启中途 Schedule
投递或 Hermes paired 结果。AS-2 direct/group 继续严格为 `NOT_RUN`；因此不创建发布 tag，也不把 `AS-1`
或整体 Hermes 上位替代标为完成。
