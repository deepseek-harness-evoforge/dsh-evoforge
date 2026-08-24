# V5.20：Schedule dispatch checkpoint 崩溃不重复渠道外部效果

## 用户结果

对绑定 exact 飞书 route 的原生 DSH Session，若一个到期 reminder 已经完成模型 turn 和第一次平台发送，但
`schedule/change dispatch` 所在的 Session persistence batch 尚未持久化时 Host 被 `SIGKILL`，恢复后的官方
Schedule 会再次处理仍 active 的 reminder。现有 Gateway 不会因此进行第二次平台发送：恢复轮复用同一
`route + turn` durable intent，既有 `delivered` 或保守恢复为 `uncertain` 的记录都不会重新进入 send。

这证明的是该 exact 故障窗口中的 **一次平台效果**，不是 Schedule 或模型 exactly-once。恢复仍可能重新运行
模型并产生 token、时延和成本；真实飞书与真实 Provider 门禁通过前也不能把 keyless 平台结果扩大为生产声明。

## 为什么不新增 causal key 或 Schedule 私库

官方 Schedule 在同一个 append-only Session 中先同步 `followup()`，再 append `schedule/change dispatch`；被
领取的 turn 事件只能排在 dispatch 之后。若 dispatch 没有跨过连续持久化 checkpoint，该完成 turn 也不可能
独立成为 durable 前缀，恢复后的原生 turn 号保持不变。

Feishu/Telegram 已经把普通 turn 写成 Gateway `intentKey = turn:<turn>`，Gateway 再以 exact route 与 intent key
内容寻址记录。第一次平台调用前 intent 已 durable；若进程在结果记录前死亡，`sending` 只会恢复为
`uncertain`，不自动重发。相同 turn/content 的再次 submit 返回原记录；content 或 destination 漂移则 fail
closed。因而无需解析 Schedule framing、复制 `schedule_id`、增加 Feishu 日程表或给 Gateway 加业务工作流。

## 真实故障注入

`packages/dsh-feishu/test/native-schedule-restart.e2e.test.ts` 的第二条进程测试加载真实 DSH Host、Agent、Session、
Schedule、JSONL persistence、StorageDomain、Gateway 和 Feishu Adapter：

1. 通过 agent-scoped `schedule_create` 创建一秒 reminder，并完成 create checkpoint；
2. test-only backend seam 在首次包含 `schedule/change dispatch` 的 `appendBatch` 上永久阻塞，不调用原 backend；
3. Agent 仍消费已 admission 的 follow-up、完成 turn，Gateway 先持久化 intent，再让 Fake Feishu transport 把
   一条接受效果追加到独立 `platform-effects.jsonl`；
4. 父进程同时观察到 dispatch barrier 被阻塞和平台效果已经存在后，向 Host 发送真实 `SIGKILL`；
5. 第二个 Host 从同一 Session/Gateway Storage 启动，官方 Schedule 再处理 overdue reminder；
6. 断言恢复 Host 的 Fake Platform 收到 `0` 次 send、跨进程 effect 文件仍只有 `1` 行、Session 最终只有一条
   create/dispatch/`plugin:schedule` message，Gateway 只有一个 `turn:1` intent 且 attempts 为 `1`。

故障点不是 production hook；fixture 只替换测试进程里 JSONL backend 的写方法。平台效果文件独立于 Host 内存，
因此第一条效果不会因 `SIGKILL` 消失。Fake Platform 不替代真实飞书，只为无凭据故障注入提供确定性观察面。

## 双版本与包级结果

focused gate 已在两个 exact 支持 revision 上运行：

- `47f943859bef60e4160492346772ded9b24f765a` / `0.1.0-rc.5`：两个进程崩溃用例 `2 passed`；
- `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `0.1.1-rc.2`：从 detached 临时 worktree 完整构建后
  `2 passed`；worktree 随后删除，两个 DSH checkout 均无源码修改；
- `pnpm --filter dsh-feishu typecheck`：通过；
- `pnpm --filter dsh-gateway test`：`7 files / 27 tests passed`；
- `pnpm --filter dsh-feishu test`：`18 files / 51 tests passed`。

根级 `pnpm check` 也通过：文档、兼容矩阵脚本、Hermes EV-1 类型检查、Provider RP-1 `8/8`、飞书 AS-2
`7/7` 无调用契约、十一包类型检查与构建全部成功，累计 `570 tests passed / 3 skipped`。

## Cache、权限与声明边界

本增量没有修改生产 runtime、Bundle、Config、Client、依赖或模型表面；cache delta 为 `none`。测试不读取真实
凭据，不调用真实飞书或付费 Provider，不产生生产外部效果。V5.19 已覆盖 create durable、dispatch 前死亡后的
一次恢复和第三次 Host 不重放；V5.20 进一步覆盖平台效果已发生、dispatch 未 durable 的反向窗口。

仍未完成：真实飞书 direct/group AS-2、真实 Provider、官方 Schedule 在该窗口中的模型/成本不重复保证、长期
重连，以及同条件 Hermes paired benchmark。上述门禁通过前不创建发布 tag，不宣称 AS-1 或整体上位替代完成。
