# ADR-0053：Delivery Outcome 从持久 Session 日志投影

DSH 明确区分易失的 `tools/result` live 事件与随后进入原生 Session event log、可通过官方 checkpoint 持久化的 `tool/result`。旧监听器在 live 事件与 StorageDomain put 之间崩溃会永久少一条 Outcome，而且 live 时刻尚未包含当前 Tool 的最终 Session 边界。对自我发现、canary 和长期结果统计而言，这个可避免的丢样本窗口不可接受。

`dsh-evolve` 只接受原生 Session 日志中由 `sourceEventSeqs` 精确连接的 `tool/call(name=complete_delivery) → tool/result`。Host 校验 call id、Tool 名、非错误 ToolResult block 和唯一 JSON text，再解析 compact canonical output；其他 Tool、错误、断链、旧序号、非 JSON 或非法 schema 全部 abstain。`observedAt` 使用 Session event time。写 Outcome 前必须先通过 `ctx.sessions.flush(session)` 这一 DSH 官方 awaited durability checkpoint；无 listener 或 checkpoint 失败则 fail closed，不写派生事实。Session 冷启动重放 persisted pair，StorageDomain 继续按 Workspace+Session+call id 幂等，为 checkpoint 与投影之间的崩溃提供补记且不重复计数的恢复路径；跨进程 kill 仍由发布门禁单独验证。

重放只重建派生 Outcome，绝不再次执行 `complete_delivery`、repository check、push、PR、Goal mutation 或任何外部效果。Outcome 仍不阻塞原 Session、不进入模型表面、不证明 Generation 因果，也不单独授权 rollback。该投影直接由 `dsh-evolve` 生命周期持有，不依赖可热卸载的 Tool registry 监听器。DSH 的 Session append 本身是同步内存提交、persistence 可异步缓冲；因此 checkpoint 前 hard kill 不能被本 ADR 冒充为已解决，必须由后续独立故障注入门禁验证。
