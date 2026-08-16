# P0B.2a：Durable Shadow Resume 本地证据

> 状态：`implemented`；本页只证明显式 resume，后续 resident supervisor 见 [P0B.2b](p0b-2b-resident-shadow-supervisor.zh.md)；仍不是自动晋升或生产长期运行证明
> 日期：2026-08-16

## 用户结果

显式执行的 Shadow 在单机进程被杀后，可以使用同一命令加 `--resume` 恢复。
它不会因为“想继续”而盲目重复可能收费的 proposal，也不会丢弃已经落盘的
Candidate 后重新生成另一个版本。

```bash
dsh-evolve shadow <skill-dir> \
  --case-pack <case-pack-dir> \
  --output <run-dir> \
  --resume
```

## 已验证边界

`shadow-resume.e2e.test.ts` 使用真实 CLI 子进程、本地 HTTP 边界、`SIGKILL`
和 macOS Sealed Trial 验证：

1. proposal intent 已 durable、HTTP 服务已经观察请求，但 response 尚未落盘时
   kill；恢复返回 `2 + incomplete/uncertain`，请求计数仍为 `1`；
2. live owner 尚在时并发 `--resume` 被 process lock 拒绝，不产生第二个请求；
3. Candidate 已 durable、Trial 运行中 kill；恢复复用同一 Candidate，只重跑无网络
   Sealed Trial，proposal 请求计数仍为 `1`，最后得到相同 `promote` 结论；
4. active Skill 始终不变；token usage、Candidate 内容/hash 和 terminal report
   reference 可恢复；API key 不进入 `run-state.json`；
5. `Idempotency-Key` 为固定 64 位 effect id，但系统不假定所有兼容 Provider
   都实现 exactly-once。

## KV Cache 与复杂度

run journal 和 lock 全在 host output directory；不注册 Tool、Skill、system prompt
或 Session event，正常 DSH Session 额外 token 为 `0`。它不是任务 DAG、Mission、
通用工作流数据库或第二 daemon。

## 尚未证明

- DSH 常驻 Job supervisor 自动扫描并继续多个离线 run；
- 多日运行、磁盘耗尽、关机/重启和 PID reuse 的大规模 soak；
- Generic Provider 对 `Idempotency-Key` 的服务端保证；
- 自动晋升、canary、线上监测和自动回滚。
