# DSH rc.2 升级兼容性复验（2026-09-13）

## 目的与边界

为真实 Web 断线后停止自动重连的问题推进官方 DSH 升级，沿用
[原生重连复现](web-task-outcomes-2026-09-13.zh.md)，不复制或修改 DSH ConnectionController。
EvoForge 起点为 `302c0c3a202e5aad1fe3ef9ac8e065544ea41dc3`；原有五项用户工作树改动保持不动。
本轮是本地、无真实模型调用的 assembled 兼容验证，不是线上升级或真实飞书验收。

用户部署仍是单一 alpha.5 Host，监听 `127.0.0.1:3000`。未访问或迁移其凭据、授权、历史和配置，
未更改模型组成、Generation 指针、晋升规则或回滚规则。临时测试 profile 由既有测试清理。

## 重新审计官方源

```text
node scripts/audit-dsh-latest.mjs --source <clean-c291e796-worktree> --json
```

本轮重新 fetch 后，HEAD 和 `origin/master` 均为
`c291e7961a515f6d7af9304e7fd1d257929aef26`，CLI `0.1.5-rc.2`，工作树 clean；
frozen install exit 0，官方根 build exit 0 / `passed`，测试后工作树仍 clean。

## 旧评测与隔离副本的对照

直接使用旧 Case Pack，在新 DSH 上运行 capability-absent、cache-safe-status、dispose-owned-watcher
三个测试文件：4 failed。首个错误明确为实际 DSH revision 与 Case Pack 的 alpha.5 revision 不匹配，
Shadow 路径返回 `incomplete`，没有被强行转换为成功。

随后只用已有维护脚本创建测试副本；不修改原始 Case Pack、不重写历史验收，不放宽运行时 exact revision 校验：

```sh
case_pack_audit_dir=$(mktemp -d)
node scripts/prepare-dsh-case-packs.mjs \
  --revision c291e7961a515f6d7af9304e7fd1d257929aef26 --out "$case_pack_audit_dir"
DSH_EVOLVE_CASE_PACK_ROOT="$case_pack_audit_dir" \
DSH_EVOLVE_DSH_SOURCE_DIR=<clean-c291e796-worktree> \
  pnpm --filter dsh-evolve exec vitest run --maxWorkers 1
```

副本中的首批三个文件为 4 passed；随后全量 Evolve 为 **81 files / 975 tests passed**，耗时 66.36 秒。
没有 skip。此结果证明现有测试覆盖范围内的新 runtime 路径可运行，不证明模型在未见任务中学会了新能力。
测试副本只更新 manifest 的 revision；它是本次兼容运行的输入，不是新的独立治理评测数据。

## 其他升级门

以下命令均设置 `DSH_EVOLVE_DSH_SOURCE_DIR=<clean-c291e796-worktree>`，每组串行执行：

```text
pnpm --filter dsh-evoforge-doctor exec vitest run test/suite-native-plugin-contract.test.ts --maxWorkers 1
pnpm --filter dsh-software-delivery exec vitest run test/clean-profile-suite.e2e.test.ts test/suite-upgrade.e2e.test.ts --maxWorkers 1
pnpm --filter dsh-evoforge-feishu exec vitest run test/dsh-assembled-chat.e2e.test.ts test/dsh-assembled-content.e2e.test.ts test/full-channel-cache-composition.e2e.test.ts test/native-schedule-restart.e2e.test.ts --maxWorkers 1
```

- Doctor：24 passed。
- clean-profile / suite-upgrade：2 passed / 1 skipped，49.16 秒；包括打包、官方安装、boot、原生执行、
  dispose、卸载和当前 runtime 的 Session 读回。历史 suite-upgrade 用例仍 skipped，不能算成旧 DSH → 新 DSH 迁移通过。
- Feishu assembled：4 files / 5 passed，45.94 秒；平台 transport 和模型是测试夹具，不等于真实飞书。

安装组首次与 Feishu 组并行执行时失败于 `dist/index.mjs` 缺失；两组都会重建同一 Feishu 产物目录。
全部并行组结束后，不改代码，串行重跑安装组通过。首次失败保留为测试编排污染，不能算作产品成功，
也没有证据要求为此修改 DSH。后续打包型验收必须串行。

## 结论与下一门

旧 Case Pack revision 拒绝已通过隔离复验消除为升级执行阻断；不能再把此前的六项失败简单归为 rc.2 不兼容。
但本轮依旧使用 alpha.5 的开发依赖和类型基线，尚未完成依赖/lockfile/CI 支持迁移、旧 profile 跨版本历史与授权
恢复、实际 rc.2 Web 重连复现、真实渠道回归。对 v3 未支持的 transcript cohort 仍按既有规则 abstain。
当前支持版本和线上部署保持 alpha.5，高优先级自动重连问题仍未关闭。

## 追加：跨版本原生会话与降级风险（12:07）

新增 `scripts/repro-dsh-session-upgrade.mjs`，调用两个 clean、built 的 exact DSH checkout。
每个阶段在独立 Node 进程运行；只加载该版本的原生 Cordis、Session、JSONL persistence、Agent、AgentLoop、
Tool、SystemPrompt、LLM 服务，使用确定性内存 LLM adapter。没有读取实际 profile、凭据、授权或历史。

```text
node scripts/repro-dsh-session-upgrade.mjs <built-alpha5> <built-c291e796>
node scripts/repro-dsh-session-upgrade.mjs <built-alpha5> <built-c291e796> --require-safe-downgrade
```

第一条命令 exit 0，证明以下 **普通已完成纯文本会话** 路径；raw JSONL 与默认 Zstandard 均通过：

1. alpha.5 原生 AgentLoop 接收消息、产生完成 turn 并 flush；不是手工拼装冒充真实执行的日志。
2. rc.2 read handle 将旧 v0 历史投影到 v3，identity 不变；append 被 `SessionReadOnlyError` 拒绝。
   完整物理文件清单和 SHA-256 均不变，read-only migration 没有发布新文件。
3. rc.2 原生 Agent resume 同一个 Session，接收第二条消息并完成。实际 LLM request 同时包含前后两条输入。
   flush/dispose 后，新进程 readback 同时包含两条消息；旧文件字节不变，另有新格式文件发布。
4. 再用 alpha.5 原生 persistence load 同一存储：**不报错，但只返回 v0 旧历史，缺少升级后消息**。
   这次旧版只读操作没有改动升级后的任何文件。

第二条命令要求降级能看见新历史或明确以不支持格式拒绝；实际 exit 1，错误为
`old runtime silently exposes stale pre-upgrade history; binary-only downgrade is unsafe`。
两种模式各重复 3 次，结果稳定；正常命令通过不是“降级安全”通过。临时数据每次在 finally 清理。

初始探针用手工追加的无 step 用户 turn，被官方 migration 以“surface before first step”拒绝；这不能用于证明
普通 Agent 会话升级失败。最终探针改为两端真实原生 AgentLoop，不靠补写历史绕过拒绝。初版路径和 Session
snapshot 调用错误也已修正，仅最终上述命令作为验收依据。

这关闭了已完成纯文本会话的 keyless 跨版本执行取样，但不覆盖真实模型、审批中的任务、Tool 外部效果、fork、
compaction、PTC 或账户授权迁移。`SessionReadOnlyError` 只证明存储 handle 权限，不能外推到 Agent policy。
仍不能直接升级现有用户目录或宣称完成支持；下一步需要真实 profile 的受控升级和明确的数据级恢复方案。
本风险属于版本组合的原生行为；EvoForge 不实现旁路迁移，不删除新格式数据，也不修改上游核心。
