# V5.139：飞书未知用户不再因首条非图片消息静默丢失

`dsh-feishu` 之前在 Gateway 授权前过滤顶层消息类型，未知用户先发送文件、音频或视频时拿不到配对码。
本轮先完成 Gateway exact endpoint 授权：未知 direct DM 仍收到一次性配对码，首条内容不会进入 Agent。

已授权 route 的非 `text`、`post`、`image` 顶层消息现在通过 Gateway outbound journal 发送明确的附件契约提示。
提示使用 `message:<messageId>` 幂等键，重复事件不重复发送，也不把外部 `fileKey`、URL 或伪造 block 写入 Session。
群聊和未授权 route 继续 deny-by-default。

验证前 canonical DSH 已 fetch 并确认 `HEAD == origin/master == 76fda729799fe9b3848dbe2c211d4b231032b81e`、
版本 `0.1.2-rc.1`、工作树 clean；assembled 支持基线为 alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

`pnpm --filter dsh-feishu exec vitest run test/dsh-assembled-chat.e2e.test.ts test/pairing-assembled.e2e.test.ts`
结果：Test Files `2 passed (2)`，Tests `2 passed (2)`。

本轮未调用真实飞书凭据，没有外部平台副作用。普通文件、音频和视频仍未宣称为 DSH 原生附件能力，
需等待官方持久附件契约或独立授权的内容能力。
