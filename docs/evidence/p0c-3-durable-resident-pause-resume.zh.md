# P0C.3 证据：Durable Resident Pause / Resume

> 日期：2026-08-16  
> 声明等级：`implemented`；这是后台恢复控制，不是暂停全部 DSH 或通用工作流引擎

## 用户结果

配置 `supervisor.runRoots` 后，用户可以通过原生 host command 控制自动 resident
Candidate/Trial recovery：

```text
/evolve pause
/evolve status
/evolve resume
```

`pause` 先把状态写入 DSH Storage Domain，再停止当前后台 recovery；因此命令完成后即使
DSH 立即崩溃，重启也不会自动继续。`resume` 先持久化解除暂停，再立即唤醒 durable run
扫描，不必等待下一个 interval。

暂停范围刻意保持窄：普通 DSH Goal/Session、显式 `dsh-evolve shadow`、人工 review、
promote 和 rollback 仍可使用。它不创建 Mission、DAG、第二个 Scheduler 或新的模型 Tool。

## 已验证边界

- 默认状态为 running，旧 Storage 数据无需迁移；
- pause/resume 幂等并跨 DSH Storage 重启保持；
- active Generation pointer 的 promote/rollback 写入保留 pause 状态；
- pause 在 durable write 完成后才取消 Supervisor；写入失败不会假装已经暂停；
- 活动 Sealed Trial 收到 AbortSignal，完整进程组取消仍由既有 runner 负责；
- pause 导致的取消不会抑制 run，resume 后可从 journal 重新发现；
- 人工从 native Jobs 取消仍抑制同一 run 到当前 DSH 进程结束，两种语义不混淆；
- 重启时若 durable 状态为 paused，Supervisor 不启动 timer 或 Trial；
- native `/evolve status` 显示 `Resident recovery: paused|running`；
- 真实 DSH Commands/Agent 上 pause/status/resume 不增加任何模型请求。

## 可复核测试

```bash
pnpm --filter dsh-evolve exec vitest run \
  test/generation-store.e2e.test.ts \
  test/shadow-supervisor.test.ts \
  test/shadow-job-runner.test.ts \
  test/resident-evolution-control.test.ts \
  test/evolve-command.test.ts

DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-evolve exec vitest run test/generation-binder.e2e.test.ts
```

本次纵切覆盖 28 个局部/真实 Storage 测试和 8 个固定 revision DSH 端到端测试。

## 当前限制

- 这是单机 DSH 进程内 Supervisor 控制，不是 High Availability；
- 不暂停用户显式启动的独立 Shadow CLI；
- 已在 macOS/固定 DSH revision 验证，生产多日 soak 仍未完成；
- 当前没有 Web/TUI；host-only Commands 没有浏览器可测面；
- 尚无 P1 自动晋升或 canary。

因此本证据只支持“后台自动恢复可以安全、持久、可解释地暂停和恢复”。

