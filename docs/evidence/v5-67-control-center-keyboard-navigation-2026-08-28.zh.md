# V5.67：原生 Control Center 同页键盘导航与可访问性

日期：2026-08-28

## 目标

把公共 Control Center 的 Surface 切换做成完整的原生 ARIA tabs 交互：用户无需打开第二个网页、无需
选择工作流或路径，即可在同一 DSH `conversation.view` 中用鼠标或键盘访问所有已安装插件的可视化面板。

## 实现

- `ControlCenterView` 为每个插件 Surface 提供稳定的 `tab` id、`aria-selected`、`aria-controls` 和 roving
  `tabIndex`；活动内容挂在唯一的 `tabpanel`，避免未渲染的隐藏面板造成悬空 ARIA 引用。
- 支持 `ArrowUp/ArrowDown` 与 `ArrowLeft/ArrowRight` 循环切换，以及 `Home`/`End` 跳到首尾；切换同时更新
  Surface 内容和焦点，不新增 Router、Session、Goal 或模型调用。
- 现有 `:focus-visible` 样式继续提供明确焦点环；移动端仍复用同一 Surface，只改变布局，不生成新页面。

## 自动化验证

通过：

- `pnpm --filter dsh-control-center typecheck`
- `pnpm --filter dsh-control-center test`（2 files / 4 tests）
- 组件测试断言 tab/panel 关联、roving `tabIndex`、方向键切换、`Home` 回首和真实 DOM focus。

## 真实 DSH Web 验证

使用 DSH 当前本地 Web Host 的单一页面 `http://127.0.0.1:3081/`，通过官方 `conversation.view` 进入同一个
`控制台` tab；测试只保留 1 个浏览器标签页。Control Center 实际显示 `运行诊断`、`渠道`、`演化` 三个
Surface，读取到 `tabpanel` 与稳定 `dsh-cc-tab-*` / `dsh-cc-panel` 关系。

在真实浏览器中执行：

1. 进入 `渠道` 后按 `ArrowDown`，焦点和选中项移动到 `演化`；
2. 在 `演化` 按 `Home`，焦点回到 `运行诊断`，内容仍在同一页面切换；
3. 刷新页面后仍回到同一 URL，Control Center、渠道 tab 和唯一 `tabpanel` 恢复；
4. 浏览器应用级 error 数量为 `0`，浏览器标签数为 `1`。测试 Host 的 Web runtime 曾记录连接重试 warning，
   但不影响页面渲染，且没有应用级 error。

## 边界

本增量只改善公共可视化入口的交互和可访问性，不改变 Gateway/Feishu 的真实外部消息、Provider、Hermes
paired 或长期效果发布门；`release-gates.json` 继续保持 blocked，未创建发布 tag。
