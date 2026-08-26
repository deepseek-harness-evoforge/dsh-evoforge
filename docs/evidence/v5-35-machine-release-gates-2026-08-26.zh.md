# V5.35 机器可执行发布阻断证据

日期：2026-08-26

## 实现

- 根目录 `release-gates.json` 记录每个 release gate 的 `status`、`requiredForTag`、证据路径和阻断原因；
- `pnpm run check:release:gates` 验证 schema、证据路径和 tag-required 状态，任何 `partial`、`not-run`、`failed` 或
  `blocked` 都返回非零；
- `pnpm run check:release:gates:test` 覆盖 manifest 结构、阻断归约和缺少 blocker 说明；
- `pnpm run release:tag -- --tag <annotated-semver> [--push]` 还要求 clean `main`、`HEAD == origin/main`、静态
  release preflight 和 release gates 全部通过，并拒绝已存在的本地/远端 tag；没有 bypass 参数。

## 当前运行结果

```text
pnpm run check:release:gates
Release gates: BLOCKED (dsh-v0.1)
```

当前明确阻断项包括：Web 控制面完整覆盖、真实飞书 AS-2、双真实 Provider、完整 Hermes paired、长期 outcome/负迁移
及外部效果数据。真实飞书最近一次等待配对码超时见 [V5.33](v5-33-real-feishu-pairing-timeout-2026-08-26.zh.md)。

## 结论

该门不把文档里的“尚未完成”当作发布资格，也不自动把 deterministic slice、单元测试或模型自评升级为真实 paired
证据。当前不能打 tag 是机器可复核的安全结果；只有补齐所有 required gate 后，才允许进入 `main → annotated tag → registry`
流程。
