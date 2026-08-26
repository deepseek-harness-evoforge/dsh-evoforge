# ADR-0099：Control Center 只拥有一个 DSH 原生视图与子 Surface 插槽

- 状态：accepted
- 日期：2026-08-26

## 背景

Gateway、飞书与演化插件分别在 `sidebar.footer.action` 中打开 `position: fixed` 面板，导致 DSH 被遮挡、页面
层级重复、视觉语言分裂，也让每个插件都重新实现标题、状态、指标、错误和响应式布局。DSH 当前 Client API
已经提供会话区原生 `conversation.view` 与 Cordis child contribution slot；Hermes、HanaAgent 和 DSH TUI 的
一手实现也共同说明，常驻运维信息应在稳定主区域内分层，而不是堆叠全屏弹窗。

## 决策

新增独立、可卸载的 `dsh-control-center` Client Module。它只注册一个原生 `conversation.view`，标签为
“控制台”，并声明一个 `evoforge.control.surface` child slot。Gateway、飞书及未来迁移的 EvoForge 插件通过
该 slot 贡献各自 Surface；Control Center 提供 Surface、Header、Status、Metric、Section、Entity、Notice、
Button 等公共视觉原语和窄屏布局，贡献者不再自带页面壳。

Cordis/DSH Slot ledger 是唯一组合注册表；不新增 Router、全局 registry、独立网站、后台服务或状态库。
Surface 只通过插件既有 Remote/DSH seam 读取和操作 Host 权威，不调用模型，不写 Session，不改变 Agent
composition。当前 Session 之外的全局页面仍不是本阶段支持面。

读取失败时保留最后一次成功快照，同时显示明确错误与刷新动作。旧快照不能被误标为新观测；Host 恢复后
由用户刷新重新读取。这一取舍让断连时仍可诊断已知 route/transport，同时避免浏览器成为第二权威。

## 被替代的旧决策

本 ADR 只替代 [ADR-0060](0060-gateway-web-is-a-read-only-host-projection.md) 中
`sidebar.footer.action` 固定面板和“读取失败必须清除快照”的展示策略；Gateway Host 的只读脱敏权威仍然
有效。它也不违反 [ADR-0025](0025-web-is-a-thin-kv-safe-adapter.md) 对独立 Control Center 服务/数据库的拒绝：
这里的 Control Center 只是可卸载的 DSH Client 组合视图，没有服务、数据库或第二控制面。

## 后果

- 用户在 DSH 原生中央工作区内查看渠道与飞书内容状态，不再被悬浮层挡住；
- 新插件复用同一视觉和生命周期接缝，至少两个真实 Adapter 已证明该抽象不是单用例包装；
- Gateway/飞书的 Remote、配对、撤销、内容就绪与投递语义不因 UI 合并而改变；
- `dsh-evolve-web` 已迁入该 slot，并已从最终 tarball 完成 Evolution Surface 的真实 Workspace/Session 浏览器
  刷新、断连保留、恢复和卸载验证；当前入口不再保留旧的固定侧栏弹窗；
- 无 Session 时没有 Control Center 原生页；若 DSH 未来提供正式全局贡献点，再单独审计，不自造 Router。
