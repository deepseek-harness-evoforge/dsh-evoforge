# V5.65：同页待批准请求自动刷新

## 修正

`dsh-gateway` 的原生 DSH Control Center `渠道` Surface 现在在当前页面启动低频 Host 只读轮询（5 秒一次），
自动发现常驻 Gateway 新增的脱敏 pending pairing request；不打开新网页、不创建第二个 Gateway、也不调用模型。
轮询请求具有独立的序列号，页面卸载、手动刷新或切换 Remote 时会取消过期结果，避免旧响应覆盖新状态。

瞬时 Host 错误、非 `ok` 结果或网络异常只丢弃本次轮询，不清空最后一次权威列表；管理员仍可在同一页按
request-id 直接批准，批准后会复用现有 Host/Workspace/Session/cwd/Agent 约束和原子 pending 消费门。

## 验证

- `pnpm --filter dsh-gateway typecheck` 通过。
- `pnpm --filter dsh-gateway test`：8 个测试文件、36 项测试全部通过；新增浏览器交互测试覆盖“初始为空→同页轮询出现请求→下一次轮询失败仍保留请求”。
- 既有单页浏览器路径与 Control Center child Surface 未改变；本增量不提升真实 Feishu AS-2、真实 Provider、Hermes paired 或长期效果发布门。

## 边界

轮询只读取 Host 的 pending projection，不能批准、晋升、回滚或改变当前 Session；权限、凭据和外部副作用仍由
现有 Gateway/Adapter 与独立治理门控制。`real-feishu-as2` 仍需真实事件到达和完整 terminal passed 证据。
