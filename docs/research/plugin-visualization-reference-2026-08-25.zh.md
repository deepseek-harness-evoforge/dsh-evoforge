# 【历史快照】DSH 插件可视化参考研究：Hermes、HanaAgent 与 DSH TUI/Web

> 当前 UI 边界只认[产品设计](../architecture/product-target-and-design.zh.md)和[当前状态](../status.zh.md)；
> 本页只保留当日视觉研究。

> 调研日期：2026-08-25（Asia/Shanghai）
> 研究边界：只研究一手源码、官方文档和当前 `dsh-evoforge` 实现；不把竞品交互当需求，不把视觉参考扩张成新的 Session、Agent Runtime、路由或审批体系。

## 1. 固定基线与证据口径

| 对象 | 固定 revision / 版本 | 本次使用的一手资料 |
| --- | --- | --- |
| DeepSeek Harness | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，`dsh-v0.1.1-rc.2` | 本地 checkout 与[官方源码](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e) |
| DSH Turtle UI（原官方 TUI 实现的独立仓库） | `b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2` | [官方仓库](https://github.com/turtle1999/turtle-ui/tree/b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2)、源码与 terminal snapshots |
| Hermes Agent | `1bbb6e5bce56e721ab685af4cd87df21bbff4d35` | [官方仓库](https://github.com/NousResearch/hermes-agent/tree/1bbb6e5bce56e721ab685af4cd87df21bbff4d35)、Dashboard/TUI/插件源码 |
| HanaAgent（官方仓库名 `openhanako`） | `1d3ef308299e9f630786384e77de45444ea59196`，`v0.450.0` | [官方仓库](https://github.com/liliMozi/openhanako/tree/1d3ef308299e9f630786384e77de45444ea59196)、插件规范与桌面端源码 |
| EvoForge 当前实现 | `8bf6c917d5b64e6b935178dcd09c27748dbaaccf` | `packages/dsh-gateway`、`dsh-feishu`、`dsh-evolve-web` 的 Client 源码 |

文中分三种口径：

- **源码事实**：能由上述固定 revision 的实现或官方规范直接验证。
- **用户痛点**：来自当前真实页面和用户反馈，不假装成竞品源码结论。
- **产品取舍**：针对 EvoForge/DSH 边界给出的设计决定，需要 ADR 和实现验证承接。

## 2. 结论先行

当前“渠道健康”最主要的问题不是颜色或圆角，而是**信息架构错误**：`dsh-gateway`、`dsh-feishu`、`dsh-evolve-web` 都把大量信息装进由侧栏 footer 按钮打开的 `position: fixed` dialog。它们在视觉上脱离 DSH 三栏骨架，在交互上遮住工作流，在代码上又各自重复 trigger、panel、loading、error、refresh、metric grid 和响应式 CSS。

DSH 当前 revision 已经提供更合适的官方 Interface：

1. `conversation.view` 是可追加的 Session 视图环；插件注册一个带 `id`、`label`、`order` 的条目，就会由 DSH 原生 Session header 渲染成标签并在中央内容区切换。这是集成“控制中心整页”的首选 Seam，不需要另造 Router，也不需要替换整个 conversation。[DSH conversation slot contract](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/contract/slots.ts) [DSH ConversationSession](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx)
2. `sidebar.footer.action` 是可追加的小型入口，适合一个健康点、异常计数或“控制中心”快捷入口，不适合承载完整页面。完整内容继续塞进 footer dialog，属于把一个浅 Interface 误用成深 Module。[DSH sidebar contract](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-sidebar/src/client/contract/slots.ts)
3. 通用可视化应该是一个新的深 Module：它拥有页面骨架、主题 token、状态语义、加载/错误/空态、响应式布局和 contribution 生命周期；Gateway、Feishu、Evolution 只做 Adapter，分别贡献自己的数据与操作，不再各自造壳。

因此推荐目标不是“把现有弹窗重新美化”，而是：**建立一个 DSH 原生 EvoForge Control Center，并迁移现有三个 fixed panel；footer 降级为紧凑、可卸载的健康入口。**

## 3. Hermes：整页控制面 + 常驻状态摘要

### 3.1 源码事实

- Hermes Dashboard 是独立的 React/Vite 管理应用；其主壳使用可收起侧栏和 route-level 中央页面，Channels、Sessions、Logs、Skills、System 等是原生页面，不是从角落弹出的巨型健康框。[Dashboard README](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/README.md) [App layout](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/src/App.tsx)
- Gateway 的概要状态常驻在侧栏 System 区：Gateway 状态和 active sessions 使用低频轮询投影；侧栏收起时退化成一个有颜色语义的点，而详细内容仍链接到整页。[SidebarStatusStrip](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/src/components/SidebarStatusStrip.tsx) [useSidebarStatus](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/src/hooks/useSidebarStatus.ts)
- Channels 页面把“Gateway 是否运行/是否需重启”放成页内 banner，把每个渠道做成一张横向卡片，状态、描述、错误、启停、Test、Configure 同行；凭据表单才使用 modal。也就是说，**观察和常用操作在页面里，编辑敏感配置才临时覆盖**。[ChannelsPage](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/src/pages/ChannelsPage.tsx)
- Hermes Dashboard 插件可声明 tab，并可向 shell/page slots 贡献内容；插件 SDK 暴露统一的 Card、Badge、Button、Dialog、Toast 等组件。[plugin types](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/src/plugins/types.ts) [plugin registry](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/src/plugins/registry.ts) [slot registry](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/web/src/plugins/slots.ts)
- Hermes Web 的主聊天在 Dashboard 中复用真实 TUI/PTTY；结构化 React UI只做 sidebar、inspector、summary、status 等辅助视图，不另写第二套主 transcript/composer。[官方 AGENTS 架构说明](https://github.com/NousResearch/hermes-agent/blob/1bbb6e5bce56e721ab685af4cd87df21bbff4d35/AGENTS.md)

### 3.2 可复用原则

- 状态摘要常驻但极简，详细诊断进入整页。
- 配置更新、Restart needed、Disconnected 等重要状态作为页内 banner，不靠 toast 一闪而过。
- 渠道列表用“名称 + 解释 + 状态 + 主操作”的稳定行/card 结构；指标不是无上下文的数字墙。
- 模态框只用于短时、聚焦、确实需要打断的配置或确认，不能承担日常观察面。

### 3.3 明确不照搬

- 不复制 Hermes 独立 Dashboard 进程、Router、配置系统或 Gateway 管理命令；EvoForge 必须留在 DSH Client/Host 插件边界。
- 不照搬 Hermes 十几个顶层侧栏入口；EvoForge 插件组需要一个控制中心和清晰的二级分区，避免把 DSH 变成新的后台管理站。
- 不采用任意字符串 slot + 动态 script 注入作为 DSH 插件模型；DSH 已有类型化 SlotMap、Cordis 生命周期和 Bundle/Client 规范。
- 不把 Hermes 的 TUI/PTTY 嵌入方式当成 DSH Web 方案；DSH Web 已有原生 conversation、trajectory 和 tool detail 视图。

## 4. HanaAgent：中央 Page、右侧 Widget 与统一插件组件层

### 4.1 源码事实

- Hana 桌面端根组件明确只编排 titlebar、左侧 sidebar、中央 AppPages、右侧 companion rail 和 overlays；Channel 是中央页面，并可带独立 inspector rail。[App.tsx](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/desktop/src/react/App.tsx) [AppPages.tsx](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/desktop/src/react/components/app/AppPages.tsx)
- 插件可分别贡献 Page 和 Widget：Page 进入中央 tab，Widget 进入右侧 Jian workspace；两者互不冲突。这把“完整工作面”和“伴随上下文的小面板”区分开，而不是所有插件都弹同一种窗。[官方插件规范](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/PLUGINS.md) [RightWorkspacePanel](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/desktop/src/react/components/right-workspace/RightWorkspacePanel.tsx)
- Page/Widget 使用 iframe 隔离，并具有 loading、error、retry、ready handshake、origin/message 检查和 capability grants；宿主负责承接失败状态，插件页面失败不会把整个主壳拖死。[PluginPageView](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/desktop/src/react/components/plugin/PluginPageView.tsx) [PluginWidgetView](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/desktop/src/react/components/plugin/PluginWidgetView.tsx) [use-plugin-iframe](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/desktop/src/react/hooks/use-plugin-iframe.ts)
- `@hana/plugin-components` 提供 CardShell、SettingRow、List、EmptyState、Button、Input、Switch 等统一 primitive；`HanaThemeProvider` 通过 CSS token 继承宿主主题并有 fallback，插件不依赖 renderer 私有 class。[layout primitives](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/packages/plugin-components/src/layout.tsx) [theme provider](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/packages/plugin-components/src/theme.tsx) [component styles](https://github.com/liliMozi/openhanako/blob/1d3ef308299e9f630786384e77de45444ea59196/packages/plugin-components/styles.css)

### 4.2 可复用原则

- 先区分 Surface 类型：中央完整 Page、右侧上下文 Inspector、侧栏紧凑 Status、临时 Dialog；每类有不同的信息量与打断级别。
- 通用方案必须包含统一 primitive 和主题 token，而不只是一个 registry。否则每个插件仍会复制颜色、间距、状态 badge 和空态。
- 宿主壳必须拥有 loading/error/retry，插件业务组件只描述自己的内容；失败边界要局部化。
- 插件贡献有显式 capability/权限边界，视觉入口不能暗中扩大 Host 权限。

### 4.3 明确不照搬

- EvoForge 自有、受信 DSH Client 插件不需要一律 iframe；这会重复 DSH Client loader、Remote、Cordis 生命周期和主题机制，并增加通信/尺寸/可访问性成本。
- 不复制 Hana 的 Agent Runtime、Phone/Channel 域、插件市场、restricted/full-access 体系或 Jian 桌面隐喻。
- 不把 Page/Widget manifest 另造为第二套 DSH 插件规范；Surface descriptor 必须建立在 DSH Cordis/Client 插件之内，并随 Fiber unload 自动消失。

## 5. DSH Turtle UI：低噪声等待态和分层诊断

### 5.1 源码事实

- Turtle UI 把 cwd、branch、model、token input/output、KV cache hit rate、context 占用和 queued steering 压缩在输入区附近的稳定 prompt 行，而不是单独弹一个常驻“状态中心”。[TUI prompt projection](https://github.com/turtle1999/turtle-ui/blob/b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2/src/index.ts) [streaming snapshot](https://github.com/turtle1999/turtle-ui/blob/b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2/tests/snapshots/conversation-streaming.expected.txt)
- 运行态 glyph 在固定 caret 列就地替换：model wait、thinking、responding、tools、compaction 有不同符号，只改变亮度并淡入淡出，不让光标左右跳动；同时尊重非 truecolor/无颜色终端。[timing model](https://github.com/turtle1999/turtle-ui/blob/b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2/src/chat/timing.ts)
- Step 完成后展示 `Model wait · Thinking · Response · Tools` 的阶段耗时；详细 `/status` 再用分组卡片展示 Session、Agent、Tokens、KV cache、Context 和时间，而不是把所有诊断始终堆在主界面。[status implementation](https://github.com/turtle1999/turtle-ui/blob/b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2/src/index.ts) [status snapshot](https://github.com/turtle1999/turtle-ui/blob/b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2/tests/snapshots/status-diagnostics.expected.txt)
- Session 列表加载态保留完整 overlay 框架、搜索框、作用域提示和底部快捷键，只把数据区显示为 `Loading sessions…`，因此加载完成不会重做整套布局。[loading snapshot](https://github.com/turtle1999/turtle-ui/blob/b08ed69e4c4edbd0dcaba556fa7b5ea6cd0f91e2/tests/snapshots/resume-sessions-loading.expected.txt)

### 5.2 可复用原则

- 使用“摘要层 → 详情层”：常驻层只保留是否健康、是否需要注意和极少关键数字；详细层才展示 route、transport、delivery、权限和历史。
- 等待态要占据最终内容的位置并保持几何稳定；不要用一个居中 Spinner 替换整页。
- 状态变化应优先使用就地颜色/图标/文字更新，避免页面抖动和反复开关浮层。
- 时间、成本、cache、失败等指标必须有语义标签和对比上下文，不能只用大数字制造“监控感”。

### 5.3 明确不照搬

- 不复制 ANSI 字符、终端卡片边框、快捷键或静态行宽；Web 要遵循 DSH theme token、响应式布局、ARIA 和 reduced-motion。
- 不把所有运行阶段映射为高饱和颜色；TUI 的关键价值恰恰是低噪声与固定位置。
- 不把 TUI overlay 当 Web modal 模板；其终端约束与 DSH Web 三栏布局不同。

## 6. DSH Web 官方边界：哪些可以做，哪些不能伪造

### 6.1 源码事实

- DSH Web 的 `AppFrame` 是 sidebar / center / details 三栏深 Module；布局持有宽度、拖动、窄屏让步和主题投影。`sidebar`、`conversation`、`details` 是 single occupant，替换它们会连同内部 child slots 一起替换，官方注释明确要求“想追加就使用内部 seat”。[ui-layout README](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-layout/README.zh.md) [ui-layout SlotMap](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-layout/src/client/index.ts)
- `shell.overlay` 是唯一 frame-wide additive layer，但官方定义是 badge、toast、status pill 等浮层，且 layer 本身 click-through。把完整控制中心长期放进去虽然“能显示”，却继续制造浮层，不解决当前信息架构问题。[AppFrame](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-layout/src/client/AppFrame.tsx)
- `conversation.view` 是 list slot，官方 chat 和 trajectory 都通过同一个注册机制贡献 ViewTab；Session header 根据条目自动生成 tab，Session body只渲染 active id。它是当前 revision 下最接近“原生插件页面”的稳定 Interface。[conversation slots](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/contract/slots.ts) [trajectory registration](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-trajectory/src/client/index.ts)
- Slot Core 把“注册组件、声明 child slots、store seat、业务 inject”收敛在一次 `register` 调用里；disposer 会随插件生命周期递归移除贡献和子 slot。通用可视化 registry 不应脱离这个生命周期另建全局 React registry。[ui-slots README](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-slots/README.zh.md)
- DSH Web 的运行等待态是 transcript 流中的一行 `Deep diving...`，15 秒后才显示 elapsed time，并提供 reduced-motion 静态样式；ConversationRoot 在 Session/hero/active 状态之间尽量保留同一 DOM seat，避免闪烁和草稿丢失。[ChatView](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/chat/ChatView.tsx) [ConversationRoot](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx)

### 6.2 对通用方案的硬约束

1. 不替换 `root`、`sidebar`、`conversation`、`details` 的 single occupant；不 fork DSH UI。
2. 中央控制面优先注册一个 `conversation.view`；每个业务插件不各占一个顶层 tab，而由控制中心 Module 声明自己的 child contribution slot。
3. footer 只保留一个可卸载的摘要/入口；不得继续由 Gateway、Feishu、Evolution 分别挂完整 fixed panel。
4. 所有 contribution 必须在 `ctx.effect` / `ctx.slots.inject` 内注册，dispose 后页面、状态和 Remote 订阅都消失；禁止模块级永久 registry。
5. Host 是权威数据源，Web 不调用模型、不自行推断健康；页面 snapshot 必须有 `observedAt`、stale/error/last-good 语义。
6. destructive 或 Protected Action 可以用短确认 Dialog；观察、筛选、刷新、查看 diff/route/transport 不得用 modal。
7. 当前 `conversation.view` 是 Session scope：无真实 Session/blank hero 时不会出现 ViewTab。首版应把这是官方边界而不是 bug 明确记录；如果未来需要“无 Session 的全局页面”，应向 DSH 上游提出 root page slot，而不是用 `document.body` fixed DOM 假装路由。

## 7. 推荐的通用可视化 Module

以下是本项目产品取舍，不是竞品源码事实。

### 7.1 Module 与 Interface

建议新增一个独立 DSH Client 插件 Module（暂名 `dsh-evoforge-control-center`），对外只暴露一个窄 Interface：

```ts
interface PluginSurfaceContribution {
  id: string
  group: 'gateway' | 'channels' | 'evolution' | 'delivery' | 'system'
  label: () => string
  order?: number
  summary?: PluginSurfaceSummary
  Component: React.ComponentType<PluginSurfaceProps>
}
```

Control Center 自己注册一个 `conversation.view`，并在同一次 DSH slot 注册中声明 child slot（例如 `evoforge.control.surface`）。Gateway、Feishu、Evolution Adapter 只向 child slot 贡献组件和自己的 typed Remote。这样 DSH SlotMap/Cordis 是唯一 registry 和生命周期账本；Control Center 不接管业务状态，也不聚合凭据。

这条 Seam 的 Depth 在于：一个 shell 隐藏了响应式几何、主题 token、loading/empty/error/stale、status tone、metrics、section、list row、inline notice、confirm action 和 accessibility 复杂度；新增 Adapter 只需要描述一个 surface。

### 7.2 页面布局

宽屏建议使用下列稳定结构，窄屏把左侧分区压成横向 tabs/下拉，不弹窗：

```text
┌ Control Center ─ 总体状态 / 异常数 / observedAt / Refresh ┐
│ Gateway  Channels  Evolution  Delivery  System            │
├───────────────┬────────────────────────────────────────────┤
│ 分区/来源      │ 当前 surface                              │
│ · Gateway     │ 状态 banner + 关键指标                    │
│ · Feishu      │ transport/routes/delivery/permissions     │
│ · Evolution   │ 候选、谱系、门禁、晋升/回滚               │
│ · Diagnostics │ 失败归因、时延、cache、恢复证据           │
└───────────────┴────────────────────────────────────────────┘
```

首屏只回答四个问题：**现在是否可用、哪里异常、最后何时观测、下一步能做什么**。route id、Workspace/Session id、权限细项、delivery history 等进入可折叠详情，避免把内部标识铺满首屏。

### 7.3 统一 primitive

至少提供：`SurfaceShell`、`SurfaceHeader`、`StatusBadge`、`MetricStrip`、`SectionCard`、`EntityRow`、`InlineNotice`、`LoadingSkeleton`、`EmptyState`、`ErrorState`、`ActionBar`、`ConfirmAction`。全部只使用 DSH theme variables 和官方 UI primitives；状态颜色统一为：

- `healthy/ready`：成功色，低饱和；
- `working/connecting/retrying`：品牌/信息色，必须配文字；
- `attention/stale`：警告色；
- `degraded/failed/uncertain`：错误色；
- `stopped/disabled/unconfigured`：中性色，不误报为故障。

颜色永远不是唯一信号；图标、文字、ARIA 状态必须同步。首次加载用最终卡片几何的 skeleton，后台刷新保留 last-good snapshot 并标记 refreshing，失败时就地显示错误和 Retry，不清空整页。

## 8. 当前实现的偏差与迁移顺序

### 8.1 用户痛点（已由当前源码和真实页面确认）

- `dsh-gateway` 的 `.dsh-gateway-panel` 是左下固定、最高接近全屏的 dialog；`dsh-feishu` 和 `dsh-evolve-web` 采用同一类 panel。它们遮挡 DSH、与原生栏宽/滚动/主题脱节，并重复维护 CSS。
- Gateway 与 Feishu 对同一 transport/routes/delivery 健康重复投影；用户必须在两个 footer 入口间切换才能判断“一条飞书消息为什么没反应”。
- 面板首屏同时暴露 lifecycle、pairing、routes、transport、delivery 和内部 id，主次不清；即使数据正确，也像调试页而不是可用产品。
- “点击一个小 footer 行 → 跳出巨大控制面”破坏尺寸预期；用户反馈的“丑”和“不能融合”本质上是这个交互不匹配。

对应审计时源码：[GatewayAction](../../packages/dsh-gateway/src/client/GatewayAction.tsx)、[FeishuAction](../../packages/dsh-feishu/src/client/FeishuAction.tsx)、[EvolutionAction](../../packages/dsh-evolve-web/src/client/EvolutionAction.tsx)。审计后 Gateway/Feishu 的 fixed CSS 已由 Control Center 迁移删除。

### 8.2 建议迁移顺序

1. 先实现 Control Center Module、原生 `conversation.view` 和公共 primitive，使用静态 fixture 验证宽/窄、浅/深主题、loading/error/empty/stale。
2. Gateway 作为第一条 vertical slice：overview、pairing、route、transport、delivery 全部进入中央 surface；footer 只保留总体状态和异常计数。
3. Feishu 不再另造健康面板；作为 Channels/Feishu Adapter 复用 Gateway transport/delivery 语义，并补充内容权限与平台诊断。
4. Evolution 迁移 overview/skills/advanced 到同一 shell；危险晋升/回滚只保留小型确认 Dialog。
5. 删除三套 fixed panel CSS 和重复 primitive；用真实 DSH Web 浏览器验证 tab 切换、refresh、失败、恢复、窄屏和 reload/dispose。

## 9. 验收标准

- 安装插件后，控制中心出现在 DSH 原生 Session view tabs 中；中央内容区切换，不遮挡整站，不创建独立 Web 应用或 Router。
- Gateway/Feishu/Evolution 至少三种 surface 使用同一壳和 primitive；卸载任一 Adapter 后其入口和订阅消失，其他 surface 不受影响。
- footer 收起/展开只显示紧凑状态，不再打开旧 fixed dialog；无异常时不制造红/黄噪声。
- 初次加载、后台刷新、Host 断开、stale last-good、空 routes、failed/uncertain delivery 都有稳定且可读的就地状态。
- 宽屏、窄屏、暗色、亮色、reduced-motion、键盘与 screen reader 均通过真实浏览器验证；没有横向溢出和无法关闭的遮罩。
- 页面不调用模型；所有状态和操作来自 typed Remote/Host 权威面，Protected Action 保持原审批/确认边界。
- 新 Adapter 不需要复制整页 CSS、loading/error/refresh 或新造全局 registry，即可贡献一个可视化 surface。
