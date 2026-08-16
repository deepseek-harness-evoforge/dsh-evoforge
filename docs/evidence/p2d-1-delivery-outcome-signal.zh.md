# P2D.1 证据：交付 Outcome 旁路信号

> 日期：2026-08-16  
> 声明等级：`implemented`；只完成第二消费者与证据积累，不代表 canary 或自动回滚

## 用户结果

同时启用 `dsh-software-delivery` 与 `dsh-evolve` 后，用户可从 host-only `/evolve status` 看到
最近交付结果的三态总数，以及归属于当前 active Generation（或 native DSH）的三态总数。
原交付会话不等待该记录，关闭 Evolve 也不影响 Software Delivery。

## Test-first 行为证据

红灯先固定了缺失模块、状态面无聚合和重启无记录。绿色实现覆盖：

- 真实 Cordis `tools/result` 只接收 `complete_delivery` 成功规范值；其他 Tool、Tool failure 和
  非法 payload 被忽略；
- 监听器同步返回，Storage `record` 在事件返回后的异步队列中发生；写盘失败只记 warning，后续
  outcome 仍可处理；
- 同一 Session + callId 重复通知只保留一条；最近记录有 1000 条上限；
- 真实固定 DSH Storage Domain 上完成 put、去重、裁剪、close、重启 reopen 与再次去重；
- 固定 DSH ToolRuntime 真正执行同名 Tool 两次，`/evolve status` 只计一次，插件卸载后重新打开
  Domain 仍读到记录；这个流程没有增加模型请求；
- 记录只含三态、短 reason、Goal/Session/call/Generation、commit 与可选 PR number；测试用仓库
  路径、check 输出和 PR URL 不会落入记录；
- DSH 源码 Loader 的 strip-only TypeScript 装配、Generation pin、hot unload 和已有 Shadow/
  Software Delivery 回归继续通过。

本地全量结果：`dsh-evolve` 85 passed / 1 skipped；`dsh-software-delivery` 24 passed / 1 skipped，
合计 109 passed。两个 skip 都是显式环境/外部效果门，不被算作通过。

公开 Draft PR 的 CI run `31945162478` 同样通过：Node 22.19.0 为 36 秒、Node 24 为 33 秒；
macOS 固定 DSH assembled lane 为 2 分 5 秒，包含新 Delivery Outcome Storage restart、真实
ToolRuntime、Generation/Shadow 回归，以及既有 Software Delivery assembled/package boundary。

## Cache、权限与边界

- 不新增 Tool、Prompt、Skill 或模型调用；动态计数只走已有 DSH Commands host plane。
- 不读取 secret，不调用 GitHub，不重跑 check，不产生外部效果。
- `tools/result` 是实时执行内事件；极窄 crash window 可能丢一条派生样本。为消除这一窗口而复制
  Tool 日志、建立 event bus 或重放外部动作得不偿失，因此当前明确接受 at-most-one-sample-loss。
- 单个 `failed`/`unknown` 不触发 rollback。业务代码失败不能被伪装成 Skill 退化。

设计取舍见 [ADR-0015](../adr/0015-delivery-outcomes-are-derived-signals.md)。下一片是用预声明
sealed canary 构造可归因的 active-vs-parent 反事实门；在门冻结前只积累样本。
