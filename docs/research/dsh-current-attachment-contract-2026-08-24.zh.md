# DeepSeek Harness 当前附件契约审计（2026-08-24）

> 性质：只读上游研究，不是插件完成证据，也不扩大 EvoForge 的支持范围。
>
> 一手来源仅限官方 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 的源码、文档与 Git 历史。
>
> 后续状态：V5.16 已另行完成 rc.5/rc.2 双版本 assembled 兼容矩阵；见[独立证据](../evidence/v5-16-dsh-dual-version-compatibility-matrix.zh.md)。下文保留本次审计发生时的支持判断，避免用后来实现追溯改写研究记录。

## 固定 revision

| 口径 | Revision | 版本与用途 |
|---|---|---|
| 审计当时的 EvoForge 支持基线 | [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a) | 源码包版本 `0.1.0-rc.5`；审计时的 assembled gate 与支持声明只绑定该 revision。 |
| 本次上游审计目标 | [`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`](https://github.com/deepseek-ai/deepseek-harness/commit/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e) | 2026-08-24 拉取官方 `origin/master`，该 commit 同时由 tag [`dsh-v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2) 指向。审计当时它尚未兼容；V5.16 后由独立矩阵加入支持。 |

两者不可混写：`rc.2` 的新源码事实不能追溯替换 `rc.5` 的安装、运行或验收证据。

## 结论

截至 `b150a551...`，DSH 的原生 durable attachment 与 provider-neutral message content **仍然只完整支持栅格图片**：PNG、JPEG、WebP、GIF。普通文件、音频和视频没有官方 `AttachmentRef`、Store 方法、核心 `ContentBlock`、浏览器 Prompt part、模型 modality 及配套 UI/adapter/compaction 的端到端契约。因此：

- 图片：有原生持久引用和消息块，`dsh-gateway` / `dsh-feishu` 可以继续把平台图片先落到 `ctx.attachments`，再只把 `ImageAttachmentRef` 写入原生 Session。
- 普通文件、音频、视频：仍不能由 Gateway 自行发明 `file` / `audio` / `video` block、把平台 key/URL/base64 塞进 Session，或据此宣称原生附件交付；这是当前上游功能缺口，而不是 EvoForge 应在插件层影子实现的 DSH Bug 修复。

## 契约逐项核对

### 图片：两版均支持，`rc.2` 只强化图片路径

`rc.5` 已定义 `ImageAttachmentRef`、`SaveImageAttachment`、`StoredImageAttachment` 和四种 `ImageMediaType`，`AttachmentStore` 只有 `validateImage/saveImage/readImage`。参见冻结 revision 的
[`types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/attachment/attachment/src/types.ts#L7-L48) 与
[`index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/attachment/attachment/src/index.ts#L27-L59)。

`rc.2` 没有扩展到新媒体类别，而是增强同一图片契约：

- `ImageAttachmentRef` 增加可选 `originalDimensions`，limits 增加必填 `maxImageDimension`，并增加 wire 侧 `EncodedImageAttachment`；见当前
  [`types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/attachment/attachment/src/types.ts#L7-L64)。
- `AttachmentStore` 增加有序 `saveImages()` 和按精确模型路由预算派生请求版本的 `readImageRequest()`；见当前
  [`index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/attachment/attachment/src/index.ts#L36-L129)。关键历史包括
  [`219d2a1`（ordered batch admission）](https://github.com/deepseek-ai/deepseek-harness/commit/219d2a1fb965ba0d67c0abc73d4152401eb52722)、
  [`d29855f`（统一 image request pipeline）](https://github.com/deepseek-ai/deepseek-harness/commit/d29855f97c406893a4167d74a53db521ab8b308b) 与
  [`2491e12`（normalize image storage API）](https://github.com/deepseek-ai/deepseek-harness/commit/2491e12fd81f0bcd0d8ed18f28878a5742cd1897)。
- 官方附件子系统标题仍是 “Durable Image Attachments”，只描述图片；见
  [`docs/subsystems/attachment.md`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/attachment.md)。官方 UI 也明确写明 “Images only”，非图片文件尚无输入栏或历史渲染；见
  [`packages/client/ui-attachment/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-attachment/README.md#L27-L31)。

### 原生消息：`rc.5` 与 `rc.2` 的媒体集合没有变化

两版核心 `ContentBlockMap` 均只有 `text`、`reasoning`、`image`、`tool-call`、`tool-result`；`ImageBlock` 持有 `ImageAttachmentRef`。`rc.2` 源码还明确要求新增核心 block 必须同时具备 adapter、UI 与 compaction 支持。参见
[`rc.5 types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm/src/types.ts#L53-L110) 与
[`rc.2 types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/types.ts#L53-L110)。两段源码逐字摘要的 SHA-256 相同。

同样，两版浏览器 `PromptContentPart` 都只有 `text | image`：
[`rc.5`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/apiproxy/src/api/sessions.ts#L86-L89)、
[`rc.2`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/host/apiproxy/src/api/sessions.ts#L90-L93)。`rc.2` 的官方模型 modality 也仍只有 `text | image`，见
[`ModelModalityMap`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/types.ts#L151-L158)。图片虽是 role-neutral block，但源码注明当前生产 adapter 输出为文本，实际图片输入仍需 exact route 声明 image modality。

### 普通文件：没有原生 file block

当前树没有 `FileAttachmentRef`、通用 binary save/read API 或核心 `FileBlock`。DeepSeek adapter 出现的 `{ type: 'file', file_id }` **只是图片在 DeepSeek Files API 上的 provider wire 表示**：输入类型仍是 `Extract<ContentBlock, { type: 'image' }>`，另一种表示是 base64 `image_url`。参见
[`serialize.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm-deepseek/src/serialize.ts#L32-L58) 与
[`imageParts()`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm-deepseek/src/serialize.ts#L137-L157)。它不能作为通用文件 Session 契约。

### 音频与视频：没有原生 block 或 modality

当前核心没有 `AudioBlock`、`VideoBlock`、相应 attachment ref/store 或 model modality。MCP 外部协议即使返回 audio，DSH 也只投影为“unsupported”文本并保留原始结果给程序调用；不会生成原生音频消息块，见
[`mcp-client/src/tools.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/mcp/mcp-client/src/tools.ts#L524-L558)。该 switch 也没有 video 分支，未知类型进入 unsupported fallback。

## 对 `dsh-gateway` / `dsh-feishu` 的兼容含义

1. **继续保留 image-only 边界。** 平台图片应先下载、校验并由 Host 的 `ctx.attachments` 持久化，Gateway 只接收原生引用；普通文件、音频、视频继续 fail closed 或显示明确 unsupported，不能降格为伪 `file` block。
2. **审计不能直接扩大支持。** 本次源码相似性判断之后，V5.16 才通过独立红测、实现和双版本 assembled 门禁，把 peer range 收紧为 exact `0.1.0-rc.5 || 0.1.1-rc.2`；未知预发布版仍不支持。
3. **`rc.2` 使用新公开图片 seam。** V5.16 后，飞书入站图片在 Host 提供时优先使用
   [`inbound-images.ts`](../../packages/dsh-feishu/src/inbound-images.ts) 的 `saveImages()` 整批准入/规范化语义；rc.5 回退仍先全量 `validateImage` 再逐个保存。Gateway 在
   [`gateway.ts`](../../packages/dsh-gateway/src/gateway.ts) 保留并重验可选 `originalDimensions`，避免静默丢弃上游引用元数据。
4. **不要把 TypeScript declaration merge 当成交付。** `ContentBlockMap` 可扩展只说明类型接缝开放；官方注释同时要求 adapter/UI/compaction 全链支持。单独在 EvoForge 声明 `file/audio/video` 不能形成 DSH 原生端到端契约。

## 上游缺口判定

- 图片：核心附件与消息契约已存在；`rc.2` 比 `rc.5` 更强，EvoForge 已在 V5.16 的独立双版本矩阵中证明其安装与 assembled 运行兼容。
- 普通文件、音频、视频：**上游 DSH 功能缺口仍然存在**。在官方 durable ref、Session block、provider adapter、compaction 和客户端展示共同落地之前，`dsh-gateway` / `dsh-feishu` 不应自行建立平行消息格式。飞书文档、知识库、云盘或多维表格等独立授权 Tool 能力，也不能被当成聊天附件契约已经补齐。
