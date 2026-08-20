# V4.32 exact Canary → future-Session rollback gate

> 声明等级：`implemented`。本页证明 Command、Remote 与 Web 的回滚动作已收敛到同一个 Host gate，并以 exact Canary 和 expected-active compare 阻止证据错配与 TOCTOU 误回滚；不证明真实 provider、最终 tarball 浏览器故障恢复、自动回滚或长期误回滚率。

## 修复的活动断点

V4.31 只能生成 `rollback-eligible` 证据。既有 Command/Control 仍直接调用 Generation Store，既不能绑定某条 exact Canary，也会在“读 active → 执行写”之间留下指针变化窗口。Web 只能展示 eligibility，无法从该证据行发起受控动作。

## 当前活动合同

- 新的 `FutureSessionRollback` 是唯一公共 future-Session 回滚写入 seam。
- 人工紧急回滚不依赖 Canary 配置，但仍重验 active Generation、Workspace 和 exact parent/native target。
- 证据回滚必须携带完整 64 位 Canary id；Host 只接受唯一、无扫描告警、归属当前 Workspace 与 exact active Generation 的 terminal `rollback-eligible` 结果。
- Host 重新验证 baseline pass、Candidate fail、calibration、assembled、composition、input integrity、active-pointer stability、零 proposer 与固定 paired trial shape；Canary 自身继续保持 `releaseAuthority: none`。
- Generation Store 的 `rollbackGeneration(workspaceId, expectedActiveId)` 在串行写临界区内比较 expected/actual active id。资格检查后若发生并发晋升或回滚，操作失败且指针不动。
- Command、Control Plane、Remote 和 Web 不再直接写 Store。`/evolve rollback` 表示显式人工回滚；`/evolve rollback <canary-id>` 表示 exact evidence action。
- Web 只在 `rollback-eligible` Canary 行显示“使用此证据回滚”，要求二次确认并传递 exact id；高级页仍保留独立的人工回滚。
- 两种动作都只影响未来 Session；当前和既有 Session 继续固定原 Generation，已发生的外部副作用不会被宣称撤销。

## 自动化覆盖

- `future-session-rollback.test.ts`：exact Canary、无 Canary 配置的人工恢复、伪造 Canary authority fail closed、跨 Workspace active Generation fail closed。
- `generation-store.e2e.test.ts`：stale expected-active id 被拒绝且 Candidate 仍 active，只有 exact expected id 才能回到 parent。
- `evolution-control-plane.test.ts` 与 `evolve-command.test.ts`：公共入口只调用回滚门；门缺失时失败且 Store 未被触碰。
- `evolution-remote.test.ts`：Remote 原样转发 exact Canary id。
- `evolution-action.client.test.tsx`：证据行要求确认，调用携带 exact Canary id，成功后重新读取 Host 权威 overview；普通人工回滚路径仍保留。
- Generation binder 与 SIGKILL crash driver 已迁移到 expected-active 合同；固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 的 Typert Host/Remote/Client 重新生成并通过 freshness/parameter verifier。

执行：

```sh
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve-web test
pnpm check
```

结果：`dsh-evolve` 52 files passed、1 skipped，208 tests passed、1 skipped；`dsh-evolve-web` 2 files / 20 tests passed；全仓文档、typecheck、test、build 门禁退出码为 0，共 437 tests passed、3 skipped。

## 未完成门禁

- 尚未从最终 tarball 在 clean profile 用真实浏览器验证 exact Canary rollback 的刷新、Host 失败、同端口恢复、Session pin 和卸载；
- 尚未用真实 provider 形成并执行 assembled Canary，也没有长期 false-rollback、负迁移和遗忘数据；
- existing-Skill 完整 baseline Bundle/Candidate、真实飞书 exact route 与同条件 Hermes paired benchmark 仍未通过；
- 本增量没有配置式无人值守自动回滚策略。

因此不创建 SemVer tag，不发布 v0.1，也不声称完整自我进化或 Hermes 上位替代已经完成。
