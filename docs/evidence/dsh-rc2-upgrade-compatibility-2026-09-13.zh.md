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
