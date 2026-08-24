# V5.17：Delivery Outcome 跨进程持久化窗口

> 日期：2026-08-24
>
> 状态：`verified`（两个本机进程故障窗口；真实长期编码任务与同模型 Hermes paired 仍未完成）

## 用户结果

`dsh-software-delivery` 完成真实 `complete_delivery` 后，即使 DSH 进程在 Session 持久化边界附近被硬杀，
EvoForge 也不会凭易失通知制造 Outcome，更不会在恢复时重新调用模型、Tool、仓库 check 或外部效果。只要
source-linked call/result 已跨过 DSH Session durability checkpoint，后续冷启动就能幂等补记 Outcome。

## 实际路径

测试为两个窗口分别创建独立 Git 仓库、linked worktree、DSH JSONL Session 根和 StorageDomain 根，并通过真实
DSH Agent、Goal、ToolRuntime、原生 Bash 与正式 `dsh-software-delivery` `complete_delivery` Tool 执行。仓库
check 向独立文件追加 `complete_delivery`，作为持久、可计数的外部效果探针。

1. `before-session-durable`：测试把真实 JSONL backend 卡在首次 `appendBatch` 进入点；此时 Tool/check 已完成，
   但 Session 还未持久。父进程收到精确窗口信号后对 DSH 子进程发送 `SIGKILL`。
2. `after-session-durable`：JSONL 正常完成 `ctx.sessions.flush(session)`，测试只在 Outcome Store 的 `record`
   边界暂停；父进程确认 Session 已耐久、Outcome 尚未写入后发送 `SIGKILL`。
3. 两个窗口都从同一持久根启动新的 DSH 进程检查。第二个窗口通过 native Agent resume 触发
   `agent/session-start`，生产 Delivery Outcome monitor 扫描同一持久 Session；恢复进程不安装或调用
   `complete_delivery`，模型 Adapter 被固定为调用即失败。

## 通过断言

- checkpoint 前：副作用 `1`，持久 Session `0`，Outcome `0`；不会从 live-only Tool 通知补造事实；
- checkpoint 后/Outcome 前：副作用 `1`，`complete_delivery` call `1`、result `1`、Goal `complete`、Outcome `1`；
- cold replay 的模型请求 `0`，没有第二次 Tool/check/外部效果；
- 两个被测子进程都以真实 `SIGKILL` 终止，不使用异常、正常 dispose 或进程内重置代替。

入口：

```sh
pnpm --dir packages/dsh-software-delivery exec vitest run \
  test/delivery-outcome-process-crash.e2e.test.ts
```

本次结果：专项 `1/1` 通过；`dsh-software-delivery` 全包 `36 passed / 1 skipped`；根级 `pnpm check`
通过文档、双版本兼容脚本、RP-1/AS-2 零调用合同、十一包 typecheck/test/build，共
`568 passed / 3 skipped`。三个 skip 仍是显式外部环境门，不计为通过。

## 边界

本门证明 Delivery Outcome 这一条投影链的本机跨进程语义，不把单机恢复称为高可用，也不证明真实长期编码任务、
远端 Draft PR reviewer、生产文件系统故障或整体 Hermes 上位替代。生产代码没有增加 fault-injection 配置、队列、
Session、Goal 或 Runtime；测试只在独立子进程中控制官方 JSONL backend 与 Outcome Store 的公开异步边界。
