# V5.100：Control Center 导航被 DSH 宽度拖拽层遮挡的真实浏览器修复

日期：2026-09-04

## 问题

用户反馈在 DSH Web 的 Control Center 中“点不进去”。键盘方向键可以切换，但鼠标点击“渠道”“飞书内容”或
“演化”只移动焦点，活动面板不变化。这个现象不能用组件单测解释，必须在真实 DSH 页面定位命中元素。

## 根因证据

本轮先 fetch 并确认最新 DSH `origin/master` 为 `76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean。该
master 的根级插件加载仍有上游 `@deepseek-ai/dsh-client-store` module-table 缺陷，因此按项目既定支持声明使用
最近可构建的 DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`0.1.2-alpha.5`）完成真实页面验证；没有修改
DSH 上游源码。

在真实 DSH `conversation.view` 页面中读取每个导航按钮中心点的 `elementFromPoint`：

```text
Control Center button center -> div.ds9YQq_widthHandle
handle rect                  -> x=376, y=76, width=40, height=644
handle z-index               -> 8
handle pointer-events        -> auto
```

该 DSH 左侧宽度拖拽层覆盖了 Control Center 导航的命中区域。键盘事件绕过了这个覆盖层，所以此前的键盘回归
仍然通过；这正是“看得到但点不进去”的原因。

## 修复

- `dsh-control-center` 的 `.dsh-cc-root` 现在建立 `position: relative; z-index: 9` 的局部层叠上下文，使整个原生
  `conversation.view` 控制面位于 DSH 宽度拖拽层之上。仅提高内部 `aside` 层级不足以越过 DSH 外部 sibling，已采用
  根节点层级而不是继续堆叠子元素。
- Control Center 的 Bundle、Router、Session、状态库和模型调用均未增加；仍是同一个 DSH 原生页面。
- `browser-doctor-bootstrap` 在调用官方 `WorkspaceRegistry` 前创建 test-owned workspace 路径，生成的 clean-profile
  overlay 不再因不存在的 `realpath` 目标而失败。
- 客户端契约测试锁定该命中层级保护，避免未来 CSS 回退后再次出现鼠标不可用。

## 真实浏览器验证

使用单一浏览器标签和一个临时 DSH Web URL，依次完成：

1. 启动 clean-profile fixture，选择真实 DSH Workspace/Session，并进入 `控制台`。
2. 鼠标点击 `渠道`、`飞书内容`、`演化`，三个 `tabpanel` 均在同页切换成功。
3. 点击 `渠道 → 刷新状态`，按钮可用，页面继续显示 `连接正常`。
4. 整页 reload，再次进入同一 `控制台`，点击 `渠道` 仍可切换。
5. `browser.tabs.list()` 仅返回 1 个标签；没有打开第二个网页或固定遮挡弹窗。

定向工程检查也通过：`dsh-control-center` typecheck、构建、2 个测试文件共 5 个测试。浏览器工具输出过一次外部
Statsig telemetry 网络超时，但 DSH 页面自身没有错误状态或加载失败；该外部遥测不属于插件运行路径。

## 边界

这项修复证明 Control Center 的真实鼠标命中和单页生命周期可用，不提升真实 Feishu AS-2、真实 Provider、Hermes
paired、长期效果或 release-tag 门。发布门继续按 [release-gates.json](../../release-gates.json) 的权威状态阻断。
