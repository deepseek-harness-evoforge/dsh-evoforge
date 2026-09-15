# ADR-0105：飞书文件外发批准原生快照，不批准可变路径

文件输出必须在手机上成为可下载附件，而不只是模型回复中的本地路径。我们选择一个默认关闭、Agent-scoped 的
`feishu_file_send` 原生 Tool：先经 DSH FS 读取输出并保存到原生 AttachmentStore，再用原生 Approval 批准确切快照
和接收方，最后提交到既有 Gateway 队列；不扫描回复自动上传，也不把入站附件授权扩张为外发授权。

## 原生 present 的渠道语义

真实升级验收发现，DSH 原生 `present` 只声明 Web 可打开的源文件，模型却可能把其成功误说成“飞书附件已发送”。
Adapter 因此在 `tools/post-execute` 中接入该原生结果：仅对当前确由飞书入站消息触发的、exact Agent 的成功
`present` 调用，经过其他 post policy 接受后，执行同一套快照、原生审批、Gateway 提交和回执等待。Web 发起的
调用不外发；失败或被其他 policy 阻止、改写 canonical value 的调用不上传。此桥不新增或替换 native Tool schema，
不修改原生声明的 canonical value；旧 Session 无需新增 `feishu_file_send` 即可使用其已有的 `present`。

首版每次只接受一个与原生结果路径完全一致的文件；多文件调用在任何快照或外发前明确拒绝，需分次交付。
开关关闭或审批缺失时返回“未确认送达”，不能将 Web 展示当作渠道成功。只有 durable `delivered` 才使 `present`
在渠道交付上成功；排队、发送中、失败和 uncertain 均返回原生错误态并禁止盲目重发。拒绝审批不会追加成功的原生
`deliverables/presented` 声明。所有权限、原生快照、接收方复核与卸载语义复用下文的同一实现。

## 权限与组成

`fileDeliveryEnabled` 独立于内容读取权限，可用于 routes 和 pairing 模式，默认 false。没有原生通用文件接口的
Host 不可启用；没有原生 Approval、Agent、工作目录或唯一当前接收方时拒绝发送。已经存在 request header 的
Session 只恢复此前出现过的 Tool；新开关不会改变旧会话的模型工具列表。稳定 Schema 不增加自动模型调用。

文件来源通过当前 Agent 的 DSH FS 解析，使用原生 `contains` 拒绝解析时位于 Session 工作区之外的目标；读取上限
为 30,000,000 字节，只接受非空普通文件与安全显示名。这是输出选择限制，不是新的 OS 沙箱，也不声称能抵抗原生
FS 契约之外的恶意并发换链。审批展示所选路径、文件名、字节数、SHA-256 和确切接收方绑定。工作目录不是额外
权限授予，其他原生 Tool policy/guard 仍可在进入 body 前拒绝。

批准的是已持久化的字节快照，而不是审批后再次打开路径的权限。开始提交前复核当前路由；Adapter 上传前从原生
附件存储读回并校验字节，再复核 live route。内容或接收方变化不能复用批准。只有 native `allowed-once` 可提交；
拒绝和取消不产生 Gateway 文件 intent，也不上传。快照即使未获批准仍可能留在原生存储，保留和清理由 DSH 管理。

## 效果、恢复与卸载

Gateway 只存原生引用和发送元数据，和文本共用串行队列；不保存字节、Host 路径或平台 file key，不建立第二审批、
附件库或 scheduler。文件只作一次平台尝试；持久 `sending` 在冷恢复时成为 `uncertain`，不自动重发。

开始提交后取消 Tool 不能保证撤回已接受的效果。Tool 有界等待 durable receipt，只有 `delivered` 表示送达；
`failed` 与 `uncertain` 返回原生错误态，排队或发送中的回执明确显示“尚未确认送达”。卸载撤销注册、取消审批与
等待并释放注入 scope；保留原生附件、Session 和 Gateway 记录，不能撤回已经发生的外部效果。

此决策的原生文件路径已在固定 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` Host 中完成隔离 Agent/Approval/
AttachmentStore/Gateway 组合验证，包括显式 Tool 和原生 `present`、原文件改写、拒绝和错误用户点击。
这些组合测试使用测试 transport；真实飞书可用性必须另有平台上传、审批与下载核对证据，不能由其通过推定。
