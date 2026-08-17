# LC-1：原生 Goal 冷恢复接续证据

> 日期：2026-08-17
>
> 状态：`implemented`；尚未达到生产多日 `verified`
>
> 包：`dsh-goal-continuity@0.1.0-alpha.1`

## 用户痛点

DSH 原生 Goal 可以在同一进程和同一 Session 内连续运行，但冷恢复时会安全地保持 disarmed。对已经
由服务管理器恢复固定持久 Session 的单机用户，这意味着每次崩溃或受控重启后都要人工执行
`/goal resume`；不操作就会让本可继续的长任务停住。

LC-1 只消除这一个重复人工步骤：部署者预先授权 exact Session id，插件在该 Session 的原生 cold
resume 边沿 rearm 仍 active、未耗尽的 Goal。它不是 DSH bug 修复；DSH 的默认 disarm 是安全语义，
插件增加的是可选部署策略。

## 最小实现与过度设计审查

公开配置只有 `autoResumeSessionIds`，最多 50 个 exact id；Bundle 默认 disabled。运行实现只有：

1. 监听原生 `agent/session-start`；
2. 只接受 `source: resume` 和 exact allowlist 命中；
3. 只读取原生 Goal 的 phase、activation 与轮次；
4. 用 exact id/revision 调用原生 `GoalService.resume`。

以下方案被明确拒绝，因为它们不增加当前用户结果，却会增加状态、权限或缓存理解成本：Mission、任务
DAG、Session 扫描器、第二 Goal store、daemon、timer、watcher、provider retry、预算账本、公共恢复
平台、通用 Control API。进程重启仍属于 launchd/systemd 等服务管理器；后续执行仍属于原生
`goal-round-driver`。

该选择可逆且配置局部，没有形成新的长期权威或难以迁移的公共协议，因此没有新增 ADR；领域词汇
`Authorized Goal Continuation` 已进入 `CONTEXT.md`，具体契约记录在
[LC-1 架构说明](../architecture/lc-1-goal-continuity.zh.md)。

## 自动化证据

本地 macOS 执行：

```text
pnpm --filter dsh-goal-continuity test
Test Files  4 passed (4)
Tests       12 passed (12)

pnpm --filter dsh-goal-continuity typecheck
exit 0

pnpm --filter dsh-goal-continuity build
exit 0
dist total 5.82 kB

pnpm check
Tests       299 passed, 3 skipped
typecheck / docs / build exit 0

pnpm test:pa1
Tests       164 passed, 1 skipped
```

测试覆盖：

- allowlisted active Goal rearm；非 allowlist 不变；
- paused、blocked、complete、fresh startup 和插件卸载后均不动；
- 空 id、超长 id、重复 id 和 50 项上限配置 fail closed；
- 两个独立真实 DSH `Context` 通过 pinned JSONL persistence 恢复同一 Session；
- 自动恢复和人工原生 resume 各产生且只产生一个有界请求，provider/model/system/tools/messages 的
  role/content cache surface 完全相等；
- `maxGoalRounds: 1` 在两条路径都由原生 Goal 阻塞为 `round-limit`；
- 独立子进程落盘后被真实 `SIGKILL`，第二个进程只继续一轮；
- tarball 经真实 `dsh plugin add` 安装为 disabled，显式配置后可 boot，remove 后原生 Agent/Goal
  仍可 boot。

CI 的 Node 22.19 与 Node 24 lane 负责 typecheck、全包测试、build 和 package contents；macOS assembled
lane 复跑真实 JSONL cold resume、`SIGKILL` 与 tarball lifecycle。最终远端 run 链接在对应 Draft PR
中保留。

## KV Cache 与 token

插件注册 0 Tool、0 Skill、0 Prompt、0 Command、0 Remote，既不改 system prompt、Tool Schema 或
Skill catalog，也不重写 Session 前缀。idle、非 allowlist 和非 cold-resume 路径额外 token 为 `0`。

授权接续会产生原生 Goal 剩余轮次本来就会产生的模型费用；这正是 Bundle 默认 disabled、配置 exact
allowlist 的原因。测试比较的是人工与自动恢复到 provider 之前的完整稳定表面，而不是只比较插件局部
字符串。

## 权限、删除与失败语义

- allowlist 是部署级 paid-operation authorization，不授予文件、shell、网络、秘密、merge、release、
  部署或不可逆外部动作权限；每轮 Tool 仍受原生 Permission/Approval 约束；
- 插件没有私有持久状态。Goal revision、activation、round count 和 blocker 都是原生 Session log 事实；
- 卸载不会删除或改写 Goal。已经成功 rearm/开始的原生轮次也不会被“反向撤销”；需要停止时使用原生
  Goal pause/cancel 或停止 Agent；
- resume 调用失败时保留 disarmed 并记录 warning；插件不在同一进程里自动重试；
- 静态 allowlist 不能区分崩溃与有意重启，两者都会继续；无法接受这一策略的 Session 不应进入列表。

## 尚缺证据

- 真实 provider 下的多日 crash/restart soak、恢复率、恢复时延和费用分布；
- 第三方陌生安装与不同服务管理器配置；
- 故障发生在真实外部 Tool 效果边界时的领域幂等/补偿数据；
- 多故障域 SLO。LC-1 只称 Local Continuity，不称 High Availability。
