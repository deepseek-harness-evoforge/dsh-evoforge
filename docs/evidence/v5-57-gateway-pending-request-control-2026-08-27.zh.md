# V5.57：常驻 Gateway 待批准请求控制面

## 目的

把陌生私聊的“配对码已经产生但管理员看不见”补成可验证的 Host 控制链。常驻 Adapter 只负责接收
平台事件和回传一次性 code；`dsh-gateway` 负责保存 pending request、授权和精确 native route。用户
不需要进入 DSH Session 发配对命令，也不需要改 profile 或重启 Gateway。

## 实现

- `GatewayPairingAuthority.pending()` 只投影 `requestId`、Adapter、创建/过期时间和账户 SHA-256 指纹；
  不返回盐、code hash、conversation、user、消息正文或凭据。
- `GatewayPairingAuthority.approveRequest()` 按一个不透明 `requestId` 原子消费 pending binding；过期、
  重放、归属漂移和 route 冲突均 fail closed。原有 code + Adapter 审批路径保持兼容。
- Gateway 在审批前仍重验 Workspace、Session ownership、cwd、live Agent、preset、provider 和 model；
  request-id 不能绕过 native Session 绑定门。
- `evoforgeGateway/pendingPairings` 是无参数只读 Remote；`approvePairingRequest` 只接收 request-id、
  Workspace 和 Session，所有状态仍来自 Host 权威。
- 同一 DSH 原生 Control Center 的“渠道”Surface 新增“待批准请求”区：显示 Adapter、剩余有效期和
  折叠技术详情，管理员可直接批准；配对码输入仍保留，便于跨设备转发 code 的兼容流程。

## 验证

- `dsh-gateway` 类型检查通过。
- Gateway 全部 35 个测试通过；覆盖 pending 脱敏、request-id 原子审批、重放拒绝、路由精确绑定和
  既有 code 审批兼容。
- Control Surface 测试 3/3 通过；覆盖待批准行、无用户身份泄漏和直接批准动作。
- pinned DSH Typert artifacts 已重新生成，Gateway Host/Remote 方法集合和参数门禁通过。
- `pnpm --filter dsh-gateway build` 与 `pnpm --filter dsh-gateway test` 通过。

## 边界

本增量只完成 pending request 的 Host 可见性和审批操作，不宣称真实 Feishu epoch-3、真实 Provider、
Hermes paired 或长期效果门已经通过。当前运行中的 `web` Host 仍只有一个 `3080` 页面；要让新 Remote
出现在已安装 profile，需在停机窗口用新 tarball 原位升级并重新验证 DSH reload/dispose。
