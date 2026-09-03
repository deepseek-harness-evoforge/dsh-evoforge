# V5.83：渠道首次连接导引与单页浏览器验收（2026-09-04）

## 目的

把首次渠道连接从“指标 + 技术详情 + 空配对表单”改成同一原生 DSH Control Center 内的事实导引，明确展示
“常驻连接 → 用户私聊 → 管理员批准”三个阶段；同时验证该导引没有引入第二个网页、第二套状态或模型调用。

## 实现

- `dsh-control-center` 新增可选的通用 `Journey` 控件。它是共享视觉组件，不拥有路由、状态或动作权限；旧的
  第三方 Surface 若没有该控件仍保持源兼容。
- `dsh-gateway` 只在存在 Feishu transport、待批准请求或 Feishu route 时贡献首次连接导引；Telegram-only
  安装不会凭空出现飞书设置入口。
- 导引状态只由 Gateway 的脱敏事实计算：`ready` / `degraded` transport、Feishu pending request 和已授权
  route。它不会推断“消息已送达”或把 WebSocket ready 冒充平台授权。
- 新增 `scripts/create-gateway-browser-overlay.mjs`，用包目录外的临时 ESM shim 加载 test-only Gateway 与
  Control Center fixture；fixture 使用 `pairedRoutes` transport，因此不需要把随机 Workspace id 写进测试 patch。

## 环境和浏览器结果

- 测试前重新执行 `git -C <deepseek-harness-checkout> fetch origin --tags`；最新远端 `master` 为
  `76fda729799fe9b3848dbe2c211d4b231032b81e`，浏览器运行锁定已完整构建的 DSH alpha.5
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- 通过官方 DSH CLI 在隔离 profile 安装 `dsh-control-center` 与 `dsh-gateway` tarball，Host 使用单一
  `dsh --profile web` 实例；没有修改 DSH 源码、没有创建 Git 分支、没有写入真实凭据。
- 只使用一个 `127.0.0.1:3082` 浏览器页面。关闭 DSH 内测提示并选择真实 fixture Session 后，进入原生
  “控制台 → 渠道”，页面显示统一的“首次连接”卡片：连接退化、要求用户私聊、随后在本页批准。
- 浏览器截图确认 DSH 原生左侧 Workspace/Session 导航、中间 Surface 导航和右侧内容区仍在同一页面；没有
  fixed dialog、独立路由或第二标签。刷新页面后仍回到同一 Session，导引和渠道状态可再次读取；`browser.tabs.list()`
  只有 1 个页面。
- 单元测试覆盖 Journey 的事实映射、旧 UI 可选兼容和 Gateway/Feishu Surface；`GatewayAction` 5/5、
  `FeishuAction` 3/3、Control Center build/typecheck 均通过。

## 证据边界

本证据证明：首次连接导引可以在原生 DSH Web 单页中被看见、刷新和恢复，且状态来源是 Host 权威事实。
它不证明真实 Telegram Bot、真实飞书外部消息/配对、真实 Provider、Hermes paired benchmark、长期负迁移/遗忘
或 release tag 已通过；这些仍由根目录 [`release-gates.json`](../../release-gates.json) 阻断。
