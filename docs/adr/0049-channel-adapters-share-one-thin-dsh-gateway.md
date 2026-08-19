# ADR-0049：渠道 Adapter 共享一个薄型 DSH Gateway

Telegram 与飞书已经证明外部身份标准化、Workspace/Session 归属、幂等入站、保守恢复、投递意图、限流和健康投影会跨平台重复；继续使用 `dsh-channel-router` 会把这个模块误解为一次函数路由，而把可靠性散落在各 Adapter。我们将未发布的包直接替换为 `dsh-gateway`，由它提供小而深的 transport-neutral Host 接缝；Telegram、飞书等 Adapter 只拥有平台 SDK、凭据、事件解析和呈现，DSH 继续拥有 Agent、Session、Goal、Schedule、Approval、权限和持久化权威。Gateway 不提供动态工作流、Agent 托管、第二审批体系或巨型平台注册表；当前先迁移已经验证的 route/ingress 内核，公共 outbound、限流和健康投影必须按真实重复点增量进入同一接缝，不能用名称提前宣称完成。由于包尚未发布且旧名表达了错误领域，不保留兼容转发包。

Gateway 先只为自身权威事实提供 `healthSnapshot()`：静态 route、原生 live Session、生命周期与持久 ingress
状态可按 exact route 子集脱敏投影，外部 account/chat/user、正文和凭据不出现在快照中。Adapter transport、
outbound journal 和 429 聚合仍不是 Gateway 权威；只有两个现有 Adapter 的共同语义和故障边界被证明后，
才迁移到公共 outbound seam，避免为“统一”预建巨型平台抽象。
