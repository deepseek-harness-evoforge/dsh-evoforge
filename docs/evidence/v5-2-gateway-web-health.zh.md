# V5.2 Gateway Web 权威健康视图证据

> 日期：2026-08-19
> 声明等级：`verified`，仅覆盖 `dsh-gateway` 的只读 Web 健康投影、刷新、失败和恢复。

## 用户结果

安装并启用 `dsh-gateway` 后，DSH Web 侧栏出现“渠道健康”。用户无需进入飞书或 Telegram 的私有诊断，
即可看到 Gateway lifecycle、route/live Session 数量、各 Adapter 的 transport kind/state/routeIds，以及
ingress/outbound/pending/uncertain/failed 聚合。页面明确标注只读取 Host 且不调用模型。

## 产品边界

- 同一个 `dsh-gateway` tarball 包含 Cordis Host、生成式 Typert Remote 和官方 DSH Client Module；
- Remote 只暴露无参数 `overview()`，返回既有 `healthSnapshot()`，没有 pause、route mutation 或平台动作；
- Client 只注册 DSH 原生 `sidebar.footer.action`，状态不持久化到浏览器；
- 读取失败先清除旧快照再显示 `alert`，不能把过期 transport 状态伪装成当前事实；
- account/chat/user、消息正文、external message id、错误正文和凭据不进入投影；
- 浏览器夹具只向正常安装的 Gateway 注册两条脱敏 transport observation；Workspace 由 DSH 原生
  `WorkspaceRegistry` 创建。夹具不创建 Agent/Session/模型或第二 Gateway，且 `test` 不进入发布包。

## 自动化证据

- `dsh-gateway` 7 个测试文件、23 项测试通过；覆盖 Remote 只读合同、Client 包合同、失败清空旧快照、
  恢复后重新读取、Host artifact 不混入浏览器代码，以及固定 revision 生成物校验；
- `pnpm --filter dsh-gateway build` 通过；Typert Host/Remote 生成物与固定 DSH revision 的 source hash 一致；
- 最终 pack 内容包含 Host、Client、类型和生成式 Remote，不包含 `test`、bin 或测试 bootstrap。
- 根级 `pnpm check` 通过：11 包 typecheck/build、全部插件测试和文档门禁全绿；Cache Contract 与 Doctor
  原生插件合同 22/22 通过；十一包 clean-profile 最终 tarball 的 add/dump/boot/真实 Session+Goal+Tool/
  dispose/remove/reboot/readback 1/1 通过，用时 30.04 秒。

## 真实 DSH 浏览器验收

1. 从 `dsh-gateway-0.1.0-alpha.1.tgz` 用官方 `dsh plugin --profile web add` 安装到全新 profile；
2. DSH 原生 `WorkspaceRegistry` 创建测试 Workspace，页面正常显示该 Workspace 与“渠道健康”入口；
3. 打开面板读取 2 条 exact route：飞书 `official-feishu-websocket/degraded`，Telegram
   `telegram-long-poll/ready`，Gateway lifecycle 为 ready，live Session 和投递 journal 均为 0；
4. 人工刷新后 `observedAt` 从 17:05:44 更新到 17:05:56，内容仍来自 Host；
5. 停止 Host 后点击刷新，面板只显示 `Failed to fetch` alert，原 2 路由和 transport 卡片全部消失；
6. 以同一 profile、同一 `127.0.0.1:63239` 端口重启 Host，不刷新整个 DSH 页面，再点刷新即恢复
   2 路由和 exact transport 状态，`observedAt` 更新到 17:06:32。

整个验收没有配置 API Key、发送模型请求、创建第二 Session/Agent/Workspace 系统或调用平台网络。

## 未覆盖

本证据不覆盖真实飞书/Telegram 消息、Command/Approval、平台凭据错误、真实 429、多日重连、完整进化
控制面或 Hermes paired benchmark，因此不支持发布或整体上位替代声明。
