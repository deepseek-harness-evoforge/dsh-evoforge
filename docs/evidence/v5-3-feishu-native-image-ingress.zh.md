# V5.3：飞书图片经 DSH 原生附件进入 Gateway

> 日期：2026-08-19
>
> 状态：`implemented` 自动化证据；真实飞书用户与真实多模态 provider 门禁未完成
> DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 本次证明的问题

飞书 `fileKey` 是平台资源身份，不能作为内容进入 DSH Session。该纵切建立并验证以下唯一合法路径：

```text
Feishu NormalizedMessage.resources
  → Adapter exact message-resource download
  → DSH AttachmentStore batch validation/save
  → content-addressed ImageAttachmentRef
  → DSH Gateway exact ingress
  → native Agent UserMessage image block
```

Gateway 不依赖飞书 SDK、不下载资源、不保存外部 key，也不创建附件仓库。固定 DSH attachment v1 只定义
PNG/JPEG/WebP/GIF 图片，因此本次没有发明通用 file/audio/video block。

## 实现证据

- `packages/dsh-feishu/src/platform.ts` 使用官方 SDK `im.v1.messageResource.get` 获取 exact message resource，
  流式读取遵守单资源字节上限和取消信号。
- `packages/dsh-feishu/src/inbound-images.ts` 先下载全批，检查 DSH 数量、单图和总字节限制，检测图片 magic，
  再对全批 `validateImage()`；只有全部通过后才 `saveImage()`。
- `packages/dsh-feishu/src/runtime.ts` 只把 `text` 与 `ImageAttachmentRef[]` 交给 Gateway。
- `packages/dsh-gateway/src/gateway.ts` 重新校验内容寻址引用和元数据；纯文本保留旧 SHA-256 兼容性，图文
  使用 schema v2 canonical hash。含图输入不执行 slash command。
- `packages/dsh-feishu/test/dsh-assembled-chat.e2e.test.ts` 在真实 assembled DSH 中注入一张有效 PNG，验证
  Session 存在原生 image block、`attachmentId` 为内容寻址引用、序列化 Session 不含外部 `fileKey`，并用
  `ctx.attachments.readImage()` 回读 exact bytes。

## 验证结果

```text
pnpm --filter dsh-gateway typecheck   PASS
pnpm --filter dsh-gateway test        PASS · 7 files / 24 tests
pnpm --filter dsh-gateway build       PASS · Typert digest/artifacts verified
pnpm --filter dsh-feishu typecheck    PASS
pnpm --filter dsh-feishu test         PASS · 14 files / 34 tests
pnpm --filter dsh-telegram typecheck  PASS
pnpm --filter dsh-telegram test       PASS · 7 files / 26 tests
pnpm test:cache-contract              PASS · 含 full-channel assembled composition
clean-profile-suite.e2e.test.ts       PASS · 11 tarballs add/dump/boot/readback/remove · 55.81s
pnpm check                            PASS · docs + 11 packages typecheck/test/build
```

首次组合测试发现 Gateway Typert source digest 因最后一次源码收紧而 stale；使用固定 DSH checkout 执行
`DSH_SOURCE_ROOT=/absolute/path/to/pinned-deepseek-harness pnpm generate:typert` 后，Gateway build verifier 与同一组
飞书/Telegram package、assembled 测试全部转绿。它证明打包使用的生成物与当前源码一致，而不是绕过门禁。

## 尚未证明

- 真实飞书用户在 exact route 发送图片并收到真实 provider 回答；
- 图片入站后的真实 Approval、断线重连与多日运行；
- 普通文件、音频、视频、文档、知识库、云盘和多维表格；
- Hermes paired benchmark、成本/时延/cache-read 优势。

因此 V5.3 只能把“飞书原生图片 assembled 纵切”标记为 `implemented`，不能把飞书整体、通用文件能力或
Hermes 上位替代标记为 `verified`/`released`。
