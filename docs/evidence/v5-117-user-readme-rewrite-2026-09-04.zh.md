# V5.117：根 README 用户文档重写

## 结论

根目录中英文 README 已从维护者流水账改为面向安装者和使用者的用户手册。首页现在先说明产品边界、pre-alpha
状态和四个能力套件，再提供本地 tarball 安装、飞书环境变量与 resident pairing、单页 Web 控制面、卸载、限制和
故障排查；内部 revision、V5 过程编号和长篇实现状态不再冒充用户入口，详细证据仍保留在 `docs/`。

文档明确说明：DSH 是唯一 Host/状态权威；EvoForge 不是 Codex 插件、第二 Runtime 或市场；npm 尚未发布；真实
Feishu、Provider、Hermes paired、长期效果和附件边界仍未完全通过。安装示例不包含任何真实凭据。

## 验证

在 canonical DSH 最新 master fetch/clean preflight 后执行：

```text
pnpm run check:docs
git diff --check
```

结果：文档链接和公共路径检查通过，差异检查通过。README 变更未修改运行时代码或 DSH 上游。

## 未完成门禁

本轮只改善开源用户入口，不改变任何运行时能力或发布门。首个 registry tag 仍受 npm 名称归属、真实 Feishu AS-2、
真实 Provider、Hermes paired、长期效果和外部 Telegram 门阻止。
