# ADR-0060：Gateway Web 是只读 Host 权威投影

> 状态：superseded in presentation by [ADR-0099](0099-control-center-owns-one-native-view-and-child-surface-slot.md)。本
> ADR 仍定义 Gateway `overview()` 的 Host 权威和脱敏边界；固定 Sidebar 面板不是当前入口。

渠道运维需要在一个位置看到 Gateway lifecycle、exact route、live Session、Adapter transport、ingress 和
outbound 状态。若由飞书、Telegram 各自维护 Web 状态，会重复事实源；若在浏览器调用模型、平台 SDK 或
直接修复 route，又会把 `dsh-gateway` 扩成第二控制面。

因此 `dsh-gateway` 在同一个可卸载包内增加官方 DSH Client Module 和生成式 Typert Remote。Host Remote 只有
无参数、只读的 `overview()`，直接返回既有 `healthSnapshot()` 的脱敏结果；Client 通过 ADR-0099 定义的
Control Center child surface 展示“渠道”入口。Surface 打开和人工刷新才读 Host，不调用模型，不连接平台，
不拥有 Workspace、Session、Agent、Goal、Approval 或 Adapter transport。平台凭据、错误正文、account、
conversation/user、消息正文和 external message id 都不能进入 Remote。

读取失败必须清除浏览器中的旧快照并显式报错，避免 Host 已离线却继续显示旧的 ready/degraded 数据；恢复
只重新读取 Host，不在 Client 建第二份持久状态。运行时 Client/Remote 与 Gateway Host 随同一个 Bundle
安装、启停和卸载，测试用 Workspace seed/transport bootstrap 位于 `test/fixtures`，不得进入 tarball。

真实验收从最终 tarball 安装到全新 DSH profile，使用原生 `WorkspaceRegistry` 建立测试 Workspace，并验证
首次读取、人工刷新、Host 停机、旧快照清除、同 profile 同端口恢复。该决策完成统一 Gateway 健康视图，
不等于真实飞书/Telegram 消息闭环、写操作控制面或整体 Hermes 上位替代已经完成。
