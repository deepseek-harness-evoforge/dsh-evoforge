# ADR-0009：Journal 是恢复事实源，DSH Jobs 只负责当前进程可见性

- 状态：Accepted
- 日期：2026-08-16
- 适用范围：`dsh-evolve` P0B.2b Local Continuity

## 背景

`dsh-evolve shadow` 已能在付费 proposal 之前写 durable intent，也能从已落盘
Candidate 重跑无网络 Sealed Trial。要让常驻 DSH 在重启后自动继续，需要一个扫描器；
但如果再造 durable Job 数据库、通用 DAG 或 daemon manager，就会重复 DSH 和操作系统
已有职责，并把一个用户功能做成内部平台。

DSH 原生 `ctx.jobs` 是当前进程的 Job registry：适合展示、取消和统一生命周期，但其
记录明确是 process-local，不能作为崩溃恢复的事实源。

## 决策

1. 每个 Shadow run 的 `run-state.json` 仍是该 run 唯一 durable authority；Generation
   继续使用 DSH Storage Domain。Job id、状态和输出不反写为第二份权威状态。
2. 可选 supervisor 由 DSH/Cordis 插件生命周期拥有；进程拉起仍交给用户已有的 DSH
   启动方式、launchd 或 systemd。
3. supervisor 只扫描显式配置 `runRoots` 的直接子目录，只自动继续
   `candidate-ready` 和 `trial-running`。它不跟随符号链接。
4. `prepared` 不会自动产生付费请求；`proposal-pending` 是外部结果不确定窗口，也不会
   自动重试。`complete`、`incomplete` 和没有精确 `resumeInputs` 的旧 run 不执行。
5. 每次恢复注册成一个原生 `evolution` Job。Jobs 只提供 host-plane 状态和取消；取消
   信号会杀死完整 Sealed Trial 进程组，journal 保持 `trial-running`，下次启动可继续。
6. supervisor 串行恢复 run，同一进程的重叠扫描合并；run-local owner lock 继续防止
   CLI、其他 DSH 进程或扫描器重复执行同一个 run。
7. supervisor 不注册 Tool、Skill 或 system-prompt section。若部署没有组合 DSH Jobs，
   基础 Shadow/Generation 能力不受影响；已配置的 supervisor 不启动。

## 后果

- 恢复链只有 journal → scanner → native Job → Sealed Trial，没有第二个 workflow 平台。
- 当前工作可以复用 DSH 已有 Job UI/控制器；重启不依赖易失 Job record。
- 正常 Agent 请求的模型可见 composition 不变，空闲扫描 token 成本为零。
- 管理员必须显式配置 run roots，并在需要 supervisor 时组合 DSH Jobs 实现。
- 该设计不承诺跨机器 exactly-once、自动重试不确定外部请求或 High Availability。

## 被拒绝的方案

- **把 DSH Job record 当恢复事实源**：它是 process-local，崩溃后不存在。
- **新增 durable scheduler/DAG**：当前只有一种可恢复工作，不足以证明公共平台价值。
- **扫描后自动重试 proposal**：可能重复收费或产生重复外部效果。
- **让模型用新 Tool 轮询状态**：增加工具表面和 token，破坏 Cache Contract，且 Job UI
  已能在 host plane 展示。
