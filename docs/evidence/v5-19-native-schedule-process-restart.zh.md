# V5.19：原生 Schedule 经进程崩溃恢复后回送飞书

## 用户结果

对已经静态绑定一个 exact 飞书 route 的原生 DSH Session，若 reminder 的 `schedule/change create` 已通过官方
Session persistence checkpoint，而 Host 在到期和 dispatch 之前被强制终止，下一次 Host 启动会由
`dsh-feishu` 通过既有 Gateway route 恢复同一原生 Agent/Session。官方 DSH Schedule 随后处理 overdue
reminder，正常完成 Agent turn，并经 Gateway durable outbound 回送原飞书线程。再启动一次 Host 不会重复模型
turn、Schedule message、Gateway intent 或平台发送。

用户结果可表述为：对一个已授权 exact 飞书 route，本插件组合把“dispatch 前已持久化的 DSH reminder + Host
进程崩溃”变成“恢复同一 Session 后一次回送，后续重启不重放”。

## 权威边界

- DSH Session JSONL 是 reminder create/dispatch 与到期 `plugin:schedule` message 的事实源；
- 官方 `@deepseek-ai/dsh-schedule` 负责 fold、overdue 判断、timer、follow-up 与 dispatch；
- `dsh-gateway` 只按静态 route 恢复原生 Agent，并持久化 transport-neutral `turn` intent；
- `dsh-feishu` 只拥有平台映射、exact thread 和实际 send；
- 本增量没有新增 Scheduler、Session、Goal、Agent Runtime、Feishu 日程表、恢复数据库、模型 Tool 或 Prompt。

`packages/dsh-feishu/test/native-schedule-restart.e2e.test.ts` 使用三个真实 DSH Host mount 和同一份 JSONL
Session/Gateway Storage：

1. 独立子进程加载官方 DSH Schedule、Gateway 与 Feishu Adapter；
2. 通过真实 agent-scoped `ctx.tools.execute(schedule_create)` 创建一秒 reminder；
3. 等待官方 `ctx.sessions.flush()` 成功，并确认尚无 dispatch 后输出 ready；
4. 父测试向该 Host 发送真实 `SIGKILL`；
5. reminder 到期后启动第二个 Host；Feishu Adapter 启动时通过 exact Gateway route 自动恢复同一 Agent；
6. 断言只有一条 create、dispatch、`plugin:schedule` message、Agent turn、Gateway `turn` intent 和 thread send，
   journal 必须达到 `delivered` 且 attempts 为 1；
7. 启动第三个 Host，断言 retained dispatch/message/intent 仍各一条，模型与 Fake Platform 都没有再次执行。

平台边界使用 keyless Fake Feishu transport；Agent、Session、Schedule、Tool registry、JSONL persistence、
Gateway Storage、Agent Loop 和 Cordis Host lifecycle 均为真实 DSH/EvoForge 组装路径。

## 双版本结果

新增门禁已加入 `scripts/run-dsh-compatibility-matrix.mjs` 的 Feishu assembled 组，并分别针对两个 exact 支持
revision 运行：

```sh
pnpm --filter dsh-feishu exec vitest run test/native-schedule-restart.e2e.test.ts --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=<rc.2-worktree> pnpm --filter dsh-feishu exec vitest run test/native-schedule-restart.e2e.test.ts --maxWorkers 1
```

- `47f943859bef60e4160492346772ded9b24f765a` / `0.1.0-rc.5`：`1 passed`；
- `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `0.1.1-rc.2`：`1 passed`；
- rc.2 使用临时 detached worktree 构建，验证后已删除；两个 DSH 仓库都没有源码修改。

包级验证：

```sh
pnpm --filter dsh-feishu typecheck
pnpm --filter dsh-feishu test
```

- 类型检查通过；
- `dsh-feishu`：`18 files / 50 tests passed`。

根级验证：

```sh
pnpm check
```

- 文档链接/公开路径、DSH 兼容矩阵脚本、Hermes EV-1 类型检查、Provider RP-1 `8/8` 与飞书 AS-2
  `7/7` 无调用契约全部通过；
- 十一包类型检查和构建全部通过；
- 根级累计 `569 tests passed / 3 skipped`。

## Cache、权限与卸载影响

本增量只增加测试、双版本门禁和证据，没有修改生产 runtime、Bundle、Config、依赖或 Client。正常 Session 的
Tool/Skill/Prompt composition 与 V5.18 完全一致，cache delta 为 `none`。测试不读取真实 App 凭据、不调用真实
飞书或付费 Provider，也不产生生产外部效果。第三次 Host mount 与现有包级 dispose 回归共同验证新门禁本身不
引入恢复资源；生产卸载语义未改变。

## 不可扩大声明的窗口

本证据只覆盖 **create 已持久化、follow-up/dispatch 尚未发生** 时的进程崩溃。官方 DSH Schedule 文档明确保留
一个更窄的重复窗口：同步 `followup()` 已经入队，但 `schedule/change dispatch` 尚未完成 checkpoint 时进程死亡，
恢复可能再次派发 reminder。EvoForge 不在 Gateway 或 Feishu 中复制 Schedule 状态来掩盖这个上游语义，因此
不能宣称 Schedule 全窗口 exactly-once。

真实飞书 direct/group AS-2、真实用户收到消息、真实 Provider、长期重连和同条件 Hermes paired 仍未完成；
这些门禁通过前不创建发布 tag，也不宣称 `AS-1` 或整体 Hermes 上位替代完成。
