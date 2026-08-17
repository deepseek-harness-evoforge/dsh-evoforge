# LC-1 Hermes paired benchmark：单机崩溃恢复

> 日期：2026-08-17；状态：一个确定性 paired slice 已通过，结果为平局，不是 High Availability 或全局 Hermes 上位声明

## 冻结范围

本 epoch 只比较一个本机进程被 `SIGKILL` 后，持久工作单元是否丢失、是否只恢复一次。配置固定为：

- DSH `47f943859bef60e4160492346772ded9b24f765a`；
- Hermes Agent `29d0cc2602e01943ab300c0382fc9d97efb376da`；
- macOS、本地持久层、网络关闭、无真实 provider；
- 权威工作单元完成持久写入后，对持有它的本机进程注入真实 `SIGKILL`；
- 重新打开 canonical storage，只允许一次后继恢复动作；
- 主指标：一次崩溃后丢失的权威工作单元，越少越好；
- 次指标：重复恢复动作，越少越好。

两边的工作抽象不同：EvoForge 恢复原生 DSH Session 中的 Goal round；Hermes 回收并重试 Kanban
worker run。因此这里只把“状态不丢、单次恢复、无重复终态记录”视为可比结果，不比较终态名字、
模型质量或工作内容。

冻结 manifest、Hermes production-path fixture、runner 和原始结果位于
`benchmarks/hermes-v0.1/lc1-crash-recovery/`。复跑：

```sh
pnpm benchmark:hermes:lc1
```

## 生产路径

EvoForge 侧启动真实 Cordis Context、DSH Agent/Session/Goal/Goal Round Driver、JSONL Session
Persistence 与 `dsh-goal-continuity`。第一个 Host 落盘 active Goal 后被 `SIGKILL`；第二个进程从同一
Session 持久层恢复，只产生一个模型请求，并由原生 `maxGoalRounds: 1` 将 Goal 置为 `blocked`。

Hermes 侧在隔离 `HERMES_HOME` 中使用 production `kanban_db` 创建并 claim task，把真实 sleeper
子进程登记为 worker 后 `SIGKILL`，再调用 production `detect_crashed_workers`。重新打开 SQLite 后，
后继 run 接管并完成；旧 run 的 completion CAS、同一后继的重复 completion 都被拒绝。fixture 不直接
修改任务状态，只读 SQL 用来冻结 run history。

## 结果

| 指标 | DSH + EvoForge | Hermes |
|---|---:|---:|
| 真实故障 | `SIGKILL` | `SIGKILL` |
| 丢失权威工作单元 | **0** | **0** |
| 恢复动作 | 1 个 Goal round | 1 个后继 worker run |
| 重复恢复/完成记录 | **0** | **0** |
| 恢复后权威状态 | `blocked`，达到原生单轮上限 | `done`，run history 为 `crashed → completed` |
| 旧执行者污染后继 | 进程已被 OS 杀死，不适用 | 旧 run completion 被拒绝 |

主指标与次指标均为 `0:0`，两端 hard gate 均通过。本 epoch 支持的最窄结论是：

> 两端在这个有界的本机 durable-work crash recovery 切片上打平；没有证据支持任一方更优。

## 不支持的声明

本试验没有测量 service manager 拉起时延、多日自动恢复率、真实模型长任务、外部 Tool 恰好一次效果、
跨主机故障转移或共享状态一致性。它不支持 `better for LC-1`、High Availability、生产稳定或全局
Hermes 上位声明；这些需要独立 epoch 和长期真实数据。
