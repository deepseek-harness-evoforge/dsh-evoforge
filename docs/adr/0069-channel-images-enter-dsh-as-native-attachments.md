# ADR-0069：渠道图片只以 DSH 原生附件引用进入 Session

- 状态：accepted
- 日期：2026-08-19
- 关联：[ADR-0049](0049-channel-adapters-share-one-thin-dsh-gateway.md)
- 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 2026-08-24 上游漂移复核

官方最新 tag `dsh-v0.1.1-rc.2`（`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）的[完整审计](../research/dsh-current-attachment-contract-2026-08-24.zh.md)没有改变本 ADR 的边界：

- `packages/attachment/attachment/src/types.ts` 与 `src/index.ts` 仍只定义并存取 `ImageAttachmentRef`；
- `packages/llm/llm/src/types.ts` 的核心 `ContentBlockMap` 仍只有 text、reasoning、image、tool-call 和 tool-result；
- `packages/llm/llm-deepseek/src/files-api.ts`、`file-store.ts` 与 `serialize.ts` 的 Files API 路径仍以 `ImageMediaType`、`RequestImageAttachment` 和 image wire part 为输入；
- `packages/attachment/attachment/README.md` 明确说明 generic files、audio、video 需要独立生命周期与 provider 契约。

因此“DeepSeek Files API 已加入 DSH”不等于 DSH 已有通用文件块。普通文件、音频和视频继续 pending；若未来上游增加原生契约，应新建 ADR 并在新的 DSH 支持基线上完成 assembled 兼容矩阵后替代本决策，而不是扩张 Gateway。

V5.16 随后完成 rc.5/rc.2 双版本兼容矩阵：rc.2 路径优先调用 Host 的有序 `saveImages()`，Gateway 保留并校验
`originalDimensions`；rc.5 继续使用“先整批 validate、再逐个 save”的兼容路径。两者都只传递官方
`ImageAttachmentRef`，没有增加 file/audio/video 私有块。

## 2026-09-15 原生通用文件边界复核

下述“只有图片”是本 ADR 当时固定版本的事实，不是当前上游能力结论。直接检查官方
`c291e7961a515f6d7af9304e7fd1d257929aef26`（CLI `0.1.5-rc.2`）和本日 fetch 后的
`0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`（CLI `0.1.6-alpha.1`）发现，两者均已提供：

- `packages/attachment/attachment/src/types.ts` 中的 `FileAttachmentRef`，只含内容地址、文件名与字节数；
- `AttachmentAdmissionPart` / `AdmittedPromptContentPart` 中的原生 `file` 成员；
- `packages/attachment/attachment/src/index.ts` 中的 `saveFile`、`saveFileStream`、`readFileStream` 与
  `fileHostPath`，由原生附件 Provider 持久化并校验文件，而非 Adapter 自建文件库。

因此通用文件接入的后续工作不再以“等待上游发明 file block”为前提，而是固定支持版本、适配原生引用、完成
权限/取消/完整性/重启与真实渠道验收。此复核本身不启用能力，不改变当前 alpha.5 支持范围，也不替代新的实现 ADR。

入站附件与出站产物仍是两种不同的动作：当前 `FeishuPlatform` 只有 `sendText` / `sendCard`，没有文件上传与发送
接口。不能仅因原生附件已存在，就声称飞书可以交付文件；更不能扫描模型回复中的本地路径并自动上传。出站必须另有
明确的原生权限决策、精确接收方、内容快照与 durable 外部效果意图，未知结果不能自动重发。

## 历史背景

飞书事件把图片表示为平台 `fileKey`。该 key 是 Adapter 的外部资源身份，不是持久内容，也不应进入
DSH Session、模型上下文或 Gateway journal。固定 DSH revision 已提供 `ctx.attachments`、
`ImageAttachmentRef` 和原生 image message block，但 attachment v1 只支持 PNG/JPEG/WebP/GIF 栅格图片，
没有通用 file/audio/video block。

若 Gateway 接受飞书 key、外部 URL、base64 或 Adapter 私有路径，它就会同时拥有平台协议和附件存储，
形成第二内容 Runtime；若把普通文件伪造成文本或图片，则无法保证权限、完整性、恢复和精确重放。

## 决策

1. 平台 Adapter 负责从 exact message/resource API 下载资源；Gateway 不依赖飞书 SDK，也不下载资源。
2. Adapter 采用部署中的 DSH `AttachmentStore` 限制。整批图片必须全部下载并通过格式、单图大小、总大小、
   数量和像素校验后，才逐个持久保存；任何成员失败时不得发布模型可见消息。
3. 跨越 Gateway 的唯一图片形态是完整、内容寻址且元数据已验证的 `ImageAttachmentRef`。Gateway 再次校验
   引用、媒体类型、尺寸和安全显示名，并把 exact refs 纳入 ingress 内容摘要。
4. 纯文本事件沿用旧摘要算法，防止升级后把已经 settled 的事件误报为内容漂移；图文使用带 schema version
   的 canonical 摘要。含图片的消息永不解释为 slash command。
5. 飞书 `fileKey`、平台 URL、base64、本地路径和资源错误正文不得进入 Session。它们只存在于 Adapter 下载边界。
6. 当前不发明通用文件消息块。普通文件、音频和视频保持 pending；文档/知识库/云盘/多维表格不复用附件
   契约，后续由 [ADR-0090](0090-feishu-content-reads-are-agent-scoped-native-tools.md) 定义为独立权限下的原生 Tool。

## 后果

- Session/Goal/Agent Runtime、附件完整性和重放语义继续由 DSH 权威实现；Gateway 保持薄且平台无关。
- Adapter 必须依赖并注入 `attachments`，clean-profile 需要安装官方 attachment provider。
- 自动化 assembled 证明只能支持“原生图片链路已实现”，不能替代真实飞书用户、真实 provider、多日重连
  或通用文件验收。
