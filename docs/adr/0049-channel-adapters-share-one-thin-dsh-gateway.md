# ADR-0049：渠道 Adapter 共享一个薄型 DSH Gateway

Telegram 与飞书已经证明外部身份标准化、Workspace/Session 归属、幂等入站、保守恢复、投递意图、限流和健康投影会跨平台重复；继续使用 `dsh-channel-router` 会把这个模块误解为一次函数路由，而把可靠性散落在各 Adapter。我们将未发布的包直接替换为 `dsh-gateway`，由它提供小而深的 transport-neutral Host 接缝；Telegram、飞书等 Adapter 只拥有平台 SDK、凭据、事件解析和呈现，DSH 继续拥有 Agent、Session、Goal、Schedule、Approval、权限和持久化权威。Gateway 不提供动态工作流、Agent 托管、第二审批体系或巨型平台注册表；当前先迁移已经验证的 route/ingress 内核，公共 outbound、限流和健康投影必须按真实重复点增量进入同一接缝，不能用名称提前宣称完成。由于包尚未发布且旧名表达了错误领域，不保留兼容转发包。

Telegram 与飞书随后共同证明了普通文本出站的真实重复点：持久 `turn/response/notice` 意图、route + intent
幂等、原生 `turn/end` 门、按 Adapter/account 串行、明确 pre-acceptance rate limit 的有界重试、模糊效果
`uncertain`、崩溃恢复、有界历史和脱敏健康计数。因此这些职责已迁入 Gateway 的
`registerTextAdapter()` 深模块；注册必须声明 exact account + routeIds 并逐条验证归属，两个 Adapter 的
私有 Delivery Store/worker 已删除。平台 SDK、凭据、实际
send 调用、卡片/Approval UI 与 transport `ready/degraded` 仍留在 Adapter；Gateway 不推断平台配额，
不提供全局 token bucket，不声称 exactly-once，也不把平台特有消息类型塞入公共契约。

`healthSnapshot()` 现在按 exact route 子集投影静态 route、原生 live Session、生命周期、持久 ingress 和
公共 outbound 元数据；外部 account/chat/user、正文、external message id、错误正文和凭据不出现在快照中。
统一 DSH Web 渠道视图和 Adapter transport 聚合仍是后续门禁。

入站二进制边界由 [ADR-0069](0069-channel-images-enter-dsh-as-native-attachments.md) 进一步收紧：平台资源
必须在 Adapter 内转换为 DSH 原生内容寻址图片引用后才能进入 Gateway；Gateway 不拥有下载、平台 key、
私有附件库或 DSH 尚未定义的通用 file block。
