# ADR-0049：渠道 Adapter 共享一个薄型 DSH Gateway

Telegram 与飞书已经证明外部身份标准化、Workspace/Session 归属、幂等入站、保守恢复、投递意图、限流和健康投影会跨平台重复；继续使用 `dsh-channel-router` 会把这个模块误解为一次函数路由，而把可靠性散落在各 Adapter。我们将未发布的包直接替换为 `dsh-gateway`，由它提供小而深的 transport-neutral Host 接缝；Telegram、飞书等 Adapter 只拥有平台 SDK、凭据、事件解析和呈现，DSH 继续拥有 Agent、Session、Goal、Schedule、Approval、权限和持久化权威。Gateway 不提供动态工作流、Agent 托管、第二审批体系或巨型平台注册表；当前先迁移已经验证的 route/ingress 内核，公共 outbound、限流和健康投影必须按真实重复点增量进入同一接缝，不能用名称提前宣称完成。由于包尚未发布且旧名表达了错误领域，不保留兼容转发包。

Telegram 与飞书随后共同证明了普通文本出站的真实重复点：持久 `turn/response/notice` 意图、route + intent
幂等、原生 `turn/end` 门、按 Adapter/account 串行、明确 pre-acceptance rate limit 的有界重试、模糊效果
`uncertain`、崩溃恢复、有界历史和脱敏健康计数。因此这些职责已迁入 Gateway 的
`registerTextAdapter()` 深模块；注册必须声明 exact account + routeIds 并逐条验证归属，两个 Adapter 的
私有 Delivery Store/worker 已删除。平台 SDK、凭据、实际
send 调用、卡片/Approval UI 与 transport `ready/degraded` 仍留在 Adapter；Gateway 不推断平台配额，
不提供全局 token bucket，不声称 exactly-once，也不把平台特有消息类型塞入公共契约。

公共出站 seam 同时拥有每次平台 send 的 wall-clock 治理。Adapter 注册必须显式声明 `sendTimeoutMs`；Gateway
把 timeout 与 registration lifecycle 组合并主动 race Adapter Promise，而不是假设第三方 SDK 必然服从 signal。
timeout、disable、reload 或 remove 都会将已 durable 标记为 `sending` 的未知效果终结为 `uncertain`，并禁止
自动重发。平台 HTTP cancellation 的具体适配仍属于 Adapter；Telegram 和飞书当前都声明 30 秒，飞书继续把
同一组合 signal 传进官方 HTTP transport。该职责是公共投递可靠性，不把 Gateway 扩展成平台连接管理器。

`healthSnapshot()` 现在按 exact route 子集投影静态 route、原生 live Session、生命周期、持久 ingress 和
公共 outbound 元数据；外部 account/chat/user、正文、external message id、错误正文和凭据不出现在快照中。
统一 DSH Web 渠道视图和 Adapter transport 聚合仍是后续门禁。

入站二进制边界由 [ADR-0069](0069-channel-images-enter-dsh-as-native-attachments.md) 进一步收紧：平台资源
必须在 Adapter 内转换为 DSH 原生内容寻址图片引用后才能进入 Gateway；Gateway 不拥有下载、平台 key、
私有附件库或 DSH 尚未定义的通用 file block。

V5.20 又验证官方 Schedule 的 followup→dispatch checkpoint 窄窗口不需要 Schedule 专属 Gateway 语义。由于
append-only Session 中 dispatch 必然早于该 follow-up 的 turn 事件，dispatch 未 durable 时恢复后的 turn 号
不变；Gateway 已 durable 的 `route + turn` intent 会复用 `delivered`/`uncertain` 结果，内容漂移则 fail closed，
因此不会第二次调用 Adapter send。Gateway 不解析 reminder framing、不复制 schedule id，也不增加通用 causal
key。该结论只保护外部渠道效果；官方 Schedule 仍可能重新运行模型并重复 token、时延和成本，不能宣称完整
exactly-once。

## 原生文件出站记录（2026-09-15）

同一 account registration 现在可选提供 `sendFile`，与文本共用串行队列、wall-clock timeout、卸载 drain、
健康投影和终态观察。文件 intent 只保存原生 `FileAttachmentRef` 的 wire shape（内容地址、名称、字节数），
不保存文件字节、Host 路径、URL 或平台 file key。读取和完整性校验由 Adapter 调用原生 Attachment Provider；
Gateway 不成为附件库，也不从模型回复推断文件。

现有单文件 Storage 对版本差异严格拒绝，不能把 `compatibleVersions` 当作自动迁移。因此保持
`evoforge_gateway_outbound` v1 文本 unit/schema 不变；同一 journal facade 另开 Gateway-owned 的原生
`evoforge_gateway_file_outbound` v1 Domain，仅容纳文件元数据。两者共用写入顺序、跨类型 identity 检查和
现有 `maxRecords` 总量约束。打开失败须关闭已经取得的全部 Domain；卸载不删除任一原生 unit 或原生附件。
旧插件不会读取新文件 Domain；这不是文件发送状态的自动降级或回滚。

文件 intent 绑定 exact 外部 endpoint、native Workspace/Session 与 preset 的摘要；提交时与实际发送前均核对，
Adapter 在异步读取附件后仍须再次核对 live route。内容、接收方或 identity 漂移拒绝；接收方变化的记录也不归因给
新 Workspace。未注册 file handler 时不能回退为文本发送。`sending` 经恢复变为 `uncertain`，文件发送始终只有一次
平台尝试，即便 rate limit 也不自动重试。幂等仍受已声明的有界记录保留期限制，不承诺无限历史 exactly-once。

这个 Host seam 不授予权限。调用者必须先完成原生文件快照和原生外发审批；飞书的默认关闭 Tool 与运行时接线由
[ADR-0105](0105-feishu-file-delivery-approves-native-snapshots.md) 定义。现用 alpha.5 尚未部署真实文件交付。

`submit()` 的回执仅表示持久入队；需要向用户报告发送结果的调用者可以在同一 registration 上调用
`waitForReceipt()`。它只观察已拥有的记录，不提交或重试发送：终态写入成功后才返回对应状态，等待期限届满时
返回当前 `prepared/sending/retrying` 等实际状态，不能解释为送达。取消等待不撤回已接受的外部效果；卸载会取消
所有等待并释放 timer/listener。终态持久化失败会拒绝等待，不能把平台的成功返回当成 durable 成功。等待不暴露
正文、文件内容或外部消息 id，过期被裁剪或归属变化的记录拒绝查询；此接缝不授予任何外发权限。
