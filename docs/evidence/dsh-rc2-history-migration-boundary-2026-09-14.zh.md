# rc.2 历史迁移边界：不能从 clean-profile 推断可升级

- 日期：2026-09-14；EvoForge `b1e63e667b0743b8aeba86f31ad4102aa70e89ed`。
- 新版 DSH：已构建、clean c291e7961a515f6d7af9304e7fd1d257929aef26，CLI 0.1.5-rc.2。
- 旧写入器：只读 checkout db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5，alpha.5。

## 官方能力与限制

读取当前源码 `packages/session/session-persistence-jsonl/README.md`、
`packages/session/session-format-v0-to-v1/README.md` 及对应实现后确认：
官方提供 v0→v1→v2→v3 迁移；read open 不发布 successor，write open 保留旧文件并独占发布新版文件。
迁移只支持冻结事件集合及可转换的历史形态；未知外部插件事件即使 ignorable 也拒绝。
保留旧 generation 不等于支持自动降级。不能以改 version 字段或删除事件绕过迁移。

## 上游检查

在 c291 源码执行：

```text
node_modules/.bin/vitest run packages/session/session-persistence-jsonl/tests/multi-edge-publication.spec.ts packages/session/session-persistence-jsonl/tests/migration-refusal.spec.ts --maxWorkers 1
node_modules/.bin/vitest run --config vitest.e2e.config.ts packages/session/session-persistence-jsonl/tests/built-migration-worker.e2e.ts --maxWorkers 1
```

第一组 2 文件、48/48 通过；第二组 1/1 通过。初次把 e2e 文件放入默认配置时只运行了两个 spec，
因此随后明确使用 e2e 配置补跑，不将未选择的文件算作通过。
built worker 样本是空历史，不能代表完整旧用户会话。

## 实际旧写入器产生的隔离反例

在全新临时根中，通过旧版已构建的 Cordis、SessionStore、JSONL backend（compression none）执行：

1. `ctx.sessions.create(SessionId('evoforge-migration-isolated'))`。
2. append `turn/start {turn:1}`。
3. append 带稳定 id、user source、单 text 的 `user/message`，surfaceOp append。
4. append `turn/end {turn:1,reason:{kind:'completed'}}`，flush Session 并 dispose 旧 Context。
5. 用新版已构建 backend 打开同一隔离根，分别执行 `open(id,'read')` 与 `open(id,'write')`。

两者均拒绝：`SessionFormatUnsupportedError`，原因为
`surface before first step cannot acquire a system head without changing chronology`。
比较完整原始文件字节确认未变化，并确认没有 `session.v3.jsonl` successor。
本地探针位于 `.native-history-migration.L38a0j/probe.mjs`；验证输出：

```json
{"oldVersion":0,"targetVersion":3,"nativeOldWriter":true,"readRefused":true,"writeRefused":true,"successorAbsent":true,"sourceByteIdentical":true}
```

这是旧原生 API 可写入的最小反例，不是实际 AgentLoop 生成的完整会话，也不证明生产历史一定涉及该形态。
本轮没有读取或修改生产会话正文、凭据、授权或 profile，没有修改 DSH 核心。

## 对部署的影响

新 profile 同版本落盘/恢复已通过，但不能据此升级已有用户历史。
下一步需只读判断实际历史形态，再在隔离副本中验证官方迁移；所有拒绝应明确保留原始数据。
在此之前保留日常 alpha.5 Host。不得由 EvoForge 重写 DSH 日志或静默丢弃不兼容事件。
这仅阻止未经验证的升级，不阻止继续改善当前受支持版本的真实 Web/渠道体验。
