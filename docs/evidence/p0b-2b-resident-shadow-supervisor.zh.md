# P0B.2b 证据：常驻 Shadow Supervisor

> 日期：2026-08-16  
> 声明等级：`implemented`；本地与 pinned DSH 自动化证据，不等同于生产多日运行

## 用户结果

常驻 DSH 可以自动发现已经写入 durable Candidate 的中断 Shadow run，并只重跑无网络
Sealed Trial。正常会话不等待、不增加 Tool 或提示词；不确定的付费 proposal 不会被
自动重试。

## 已验证边界

- 扫描仅接受 `candidate-ready` / `trial-running`，忽略 prepared、外部不确定窗口和终态；
- `resumeInputs` 保存 canonical Skill/Case Pack 路径，但 journal 中没有 API key；
- run root 只检查直接目录，不跟随 run symlink；损坏 run 或单个磁盘错误不阻止其他 run；
- 重叠扫描合并，同一进程串行恢复；250 次重复扫描没有再次执行已完成 run；
- CLI 在 Trial 中被 `SIGKILL` 后，supervisor 复用同一个 Candidate，proposal 请求总数仍为 1；
- DSH 关闭信号杀死 macOS Seatbelt 下完整进程组，journal 保持 `trial-running`，再次扫描完成；
- 当前恢复注册为 pinned DSH 的原生 `evolution` Job；成功、取消和失败状态均按 Job 合同结算；
- supervisor 装配后仍未改变 system prompt，基础包在没有 Jobs/supervisor 时仍可加载和卸载。

## 可复核测试

```bash
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve test
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-evolve exec vitest run \
  test/shadow-jobs-dsh.e2e.test.ts \
  test/generation-store.e2e.test.ts \
  test/shadow-resume.e2e.test.ts
pnpm --filter dsh-evolve build
```

关键测试：

- `shadow-supervisor.test.ts`：阶段白名单、symlink、并发、错误隔离、重复扫描；
- `shadow-job-runner.test.ts`：Job 成功/取消/失败适配；
- `shadow-jobs-dsh.e2e.test.ts`：真实 pinned DSH LocalJobRegistry；
- `shadow-resume.e2e.test.ts`：真实 CLI `SIGKILL`、关机中止、自动恢复、proposal 不重复；
- `sealed-trial-darwin.e2e.test.ts`：取消在 2 秒内杀死进程组；
- `generation-store.e2e.test.ts`：真实 Loader 注入 Jobs + supervisor，模型 composition 不变。

## 仍未证明

- Linux/Windows Sealed Trial backend；
- 生产机器连续多日 soak、真实磁盘耗尽和大量 run 的性能数据；
- 普通用户可理解的 review/promote/rollback 控制面；
- 自动晋升、canary、回归自动回滚或相对 Hermes 的完整产品胜出。

因此本证据只支持“P0B.2b resident recovery 已实现”，不支持“完整持续进化已完成”。
