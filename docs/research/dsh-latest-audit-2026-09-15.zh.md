# DSH 上游构建与文件能力复核（2026-09-15）

## 固定结果

- 官方 fetch 后 `origin/master`：`0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`。
- CLI 版本：`0.1.6-alpha.1`；本次 fetch 新增 `dsh-v0.1.6-alpha.1` tag，未把 tag 身份当作 master revision。
- 使用独立 detached worktree，审计要求 clean 且 HEAD 与 `origin/master` 相同；没有修改 DSH 源码。
- 命令：`pnpm run audit:dsh:latest -- --source <isolated-0d1f5000-worktree>`。
- `pnpm install --frozen-lockfile --ignore-scripts`：passed。
- 官方根 `pnpm build`：passed。审计命令 exit 0，分类 `passed`。

本日没有启动新版 Host，也没有替换现用 alpha.5、读取凭据或迁移实际用户历史。

## 对文件交付的影响

原生附件已有 `FileAttachmentRef`、file admission、`saveFileStream` 和 `readFileStream`。也逐项核对了此前
已构建的 `c291e796…`：它同样已有这些文件接口。因此不是本次升级才新增的能力，旧 ADR 的“上游仅支持图片”
只能解释历史固定版本，不能继续阻挡新版本上的通用文件适配。

当前 EvoForge 飞书平台接口仍只有文本/卡片发送，没有文件上传与发送。真实飞书的既有验收只交付本地路径，
不能宣称手机可下载产物。原生存储能力与外部发送授权不能相互替代，具体边界见
[附件 ADR 的本日复核](../adr/0069-channel-images-enter-dsh-as-native-attachments.md)。

## 不变的支持边界

此记录只证明新上游可构建和上述源码接口存在，不证明 EvoForge 兼容 `0.1.6-alpha.1`。当前支持基线仍为
`0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
[9 月 11 日的 rc.2 审计](dsh-latest-audit-2026-09-11.zh.md)及后续测试仅属于其各自固定 revision，不能迁移成
本版本的测试结论。后续实现须完成原生组合、权限拒绝、取消/卸载、durable 外部效果、实际文件交付与恢复验收。
