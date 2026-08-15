# P0A.2：macOS Sealed Trial 原语证据

> 状态：`implemented`；已接入可信确定性 evaluator，未开放任意 Candidate 代码执行。

## 要证明什么

在 macOS 上启动一个真实 Node.js Candidate 进程，使用 deny-by-default
Seatbelt profile，只开放其规范化 workspace 和入口可执行文件。测试不 mock
文件系统、网络或子进程。

## 已验证边界

`packages/dsh-evolve/test/sealed-trial-darwin.e2e.test.ts` 证明：

- workspace 内可读写；
- workspace 外文件不可读、不可写，均返回 `EPERM`；
- 未声明的 `/bin/sh` 不可执行；
- 到数值 IP 的网络连接被拒绝，避免把 DNS 失败误当成网络隔离；
- 父进程的测试秘密环境变量不进入 Trial；
- 超过 wall-clock 预算的进程组被 `SIGKILL`；
- stdout 与 stderr 使用共同字节上限，超限即截断并终止。

复核命令：

```bash
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve typecheck
pnpm check
```

2026-08-15 首个原语切片的本机结果为 2 个测试文件、9 条测试全部通过，
随后 typecheck、build 与完整 `pnpm check` 通过。后续 P0A.3 纵切把该原语接入
四次独立的可信 evaluator Trial，见 [P0A.3 证据](p0a-3-calibrated-paired-trial.zh.md)。

## 尚不能声称什么

- 该原语尚未执行 Candidate assembly 或任意模型生成代码；
- 没有 workspace 磁盘配额，不能运行不受信任的任意 Candidate；
- 只验证当前 macOS Seatbelt 环境，不代表 Linux 或 Windows；
- 当前只证明 search evidence 与可信 evaluator/final-test 的基本信息分区；
- 它不是第二套 Agent Runtime，只是 `dsh-evolve` 私有的离线进程边界。

因此此证据把 Sealed Trial 的 macOS 执行原语标为 `implemented`，不把完整
P0A evaluator、持续进化或生产安全标为完成。
