# V5.86：清理旧 Evolution 固定弹层（2026-09-04）

## 背景

`dsh-evolve-web` 已经把活动入口迁移到 DSH 原生 `conversation.view` 的 Evolution Surface，但保留的
`EvolutionAction` 兼容导出仍使用旧的 `dsh-evolve-panel` 固定定位和确认遮罩样式。即使该导出不是当前
Bundle 的注册路径，它仍会让第三方嵌入者得到一个独立浮层，违背“一个 DSH Web 页面、原生控制面、无固定
遮挡弹窗”的产品约束，也容易被误认为第二套控制面。

## 实施

- 保留 `EvolutionAction` 导出以维持源码兼容，但把打开后的容器改为文档流中的
  `dsh-evolve-inline`；它不创建新路由、新页面或 fixed overlay。
- 删除旧 `dsh-evolve-panel` 的 `position: fixed` 样式和未使用的确认 backdrop 样式。
- 在 `dsh-evolve-web` package contract 中加入负向断言：客户端不得引用旧 panel，样式不得包含任意形式的
  `position: fixed`、旧 panel 或旧 backdrop。
- 用户 README 明确说明：活动路径是原生 Control Center Surface，兼容导出仅为 inline 嵌入，不再提供固定弹层。

## DSH 版本审计

本轮开发和测试前重新执行 `git fetch origin --tags --prune`。DSH 工作树干净，远端 `master` 与本地
`HEAD` 均为 `76fda729799fe9b3848dbe2c211d4b231032b81e`，最新公开 tag 为 `dsh-v0.1.2-rc.1`；其根级
构建仍受上游入口问题影响。可复现的构建和 assembled 检查继续使用已审计、干净的
`0.1.2-alpha.5` revision `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，没有修改或掩盖 DSH 上游问题。

## 验证

使用上述 alpha.5 支持基线完成：

- `pnpm run check:docs`：通过；
- `pnpm run check:ci`：25 个引用文件和 revision/preflight 约束通过；
- `pnpm run check:suites`：5/5 通过；
- `DSH_EVOLVE_DSH_SOURCE_DIR=<clean-alpha5> pnpm --filter dsh-evolve-web typecheck`：通过；
- `pnpm --filter dsh-evolve-web test`：2 个文件、27/27 通过；
- `pnpm --filter dsh-evolve-web build`：Host/Client artifact 校验通过；
- `DSH_EVOLVE_DSH_SOURCE_DIR=<clean-alpha5> pnpm run check`：完整合同、12 包 typecheck、测试和 build 通过。

活动 Evolution Surface 的真实单页、刷新恢复和无固定弹窗验收仍以
[V5.83 渠道单页证据](v5-83-channel-journey-single-page-browser-2026-09-04.zh.md)及既有 Evolution
浏览器证据为准；本次只清理未注册的兼容路径，没有把静态契约或本地构建冒充新的真实渠道验收。

## 发布影响

这是 UI 边界和兼容路径清理，不提升真实 Feishu AS-2、真实 Provider、Hermes paired、长期负迁移/遗忘或
release tag 门禁。当前仍禁止创建首个 annotated tag；上述发布门仍需真实证据。
