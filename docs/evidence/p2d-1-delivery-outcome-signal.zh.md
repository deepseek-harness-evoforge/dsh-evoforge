# P2D.1 证据：交付 Outcome 持久日志投影

> 日期：2026-08-16  
> 声明等级：`implemented`；只完成第二消费者与证据积累，不代表单条 Outcome 可授权 canary 或自动回滚。2026-08-19 的 durable projection 修正见 [ADR-0053](../adr/0053-delivery-outcomes-project-from-durable-session-log.md)。

## 用户结果

同时启用 `dsh-software-delivery` 与 `dsh-evolve` 后，用户可从 host-only `/evolve status` 看到
最近交付结果的三态总数，以及归属于当前 active Generation（或 native DSH）的三态总数。
原交付会话不等待该记录，关闭 Evolve 也不影响 Software Delivery。Outcome 的权威输入是原生
Session 日志，不再是 live-only 通知。

## Test-first 行为证据

红灯先固定了缺失模块、状态面无聚合和重启无记录。绿色实现覆盖：

- 只接受 `sourceEventSeqs` 精确连接的 `tool/call(name=complete_delivery) → tool/result`；
  其他 Tool、Tool failure、断链、非 JSON 和非法 payload 被忽略；
- Session event 监听同步返回，异步投影先等待官方 `ctx.sessions.flush(session)` durability checkpoint，
  再写 Storage；无 durability listener、checkpoint 或写盘失败只记 warning 并 fail closed，后续
  Outcome 仍可处理；cold Session start 重放 persisted pair 并由同一内容 id 去重；
- 同一 Session + callId 重复通知只保留一条；最近记录有 1000 条上限；
- 真实固定 DSH Storage Domain 上完成 put、去重、裁剪、close、重启 reopen 与再次去重；
- 固定 DSH ToolRuntime 真正执行 Tool，再用原生 Session call/result vocabulary 持久提交；
  `/evolve status` 计一次，插件卸载后重新打开 Domain 仍读到记录；这个流程没有增加模型请求；
- 记录只含三态、短 reason、Goal/Session/call/Generation、commit 与可选 PR number；测试用仓库
  路径、check 输出和 PR URL 不会落入记录；
- DSH 源码 Loader 的 strip-only TypeScript 装配、Generation pin、hot unload 和已有 Shadow/
  Software Delivery 回归继续通过。

本地全量结果：`dsh-evolve` 85 passed / 1 skipped；`dsh-software-delivery` 24 passed / 1 skipped，
合计 109 passed。两个 skip 都是显式环境/外部效果门，不被算作通过。

公开 Draft PR 的 CI run `31945162478` 同样通过：Node 22.19.0 为 36 秒、Node 24 为 33 秒；
macOS 固定 DSH assembled lane 为 2 分 5 秒，包含新 Delivery Outcome Storage restart、真实
ToolRuntime、Generation/Shadow 回归，以及既有 Software Delivery assembled/package boundary。

2026-08-19 durable projection 修正的本地复验为：`dsh-evolve` 254 passed / 2 skipped；其中
真实固定 DSH 的 Generation/canary 两条定向路径均通过。整仓十一包 typecheck/build 通过，
native plugin contract 22/22 通过，clean-profile 十一包 tarball add/dump/boot、真实
Session/Goal/Tool、dispose/remove/reboot/readback 1/1 通过（25.46 秒）。两个 skip 仍是显式
环境/外部效果门，不算作通过；该页当时尚未完成的跨进程门已于 2026-08-24 由
[V5.17](v5-17-delivery-outcome-process-crash.zh.md) 补齐。

## Cache、权限与边界

- 不新增 Tool、Prompt、Skill 或模型调用；动态计数只走已有 DSH Commands host plane。
- 不读取 secret，不调用 GitHub，不重跑 check，不产生外部效果。
- `tools/result` 是易失实时事件，不再有 evidence authority。checkpoint 成功后若进程在 Outcome
  投影前崩溃，只重放 persisted Session call/result pair 来补记 StorageDomain；不复制 Session、
  不建立 event bus，也绝不重放 Tool 或外部动作。checkpoint 前与 checkpoint 后/Outcome 前 hard kill 已由
  [V5.17](v5-17-delivery-outcome-process-crash.zh.md) 以独立进程验证。
- 单个 `failed`/`unknown` 不触发 rollback。业务代码失败不能被伪装成 Skill 退化。

设计取舍见 [ADR-0015](../adr/0015-delivery-outcomes-are-derived-signals.md)。后续 P1.2 已用原
Case Pack 与 exact Git parent/Candidate 实现反事实门；见
[当前 canary 边界](../architecture/evolution-design.zh.md)。单条 Outcome 本身仍只是一条信号。
