# 飞书连接故障与 Host 恢复（2026-09-13）

范围：本机试用修复，不是发布或 Hermes 替代验收。源码基线 main `52fb1a0` 加本提交。
支持运行时仍为官方 DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，其部署 checkout clean。
本轮先前已复核 canonical `c291e796…`；后续 fetch 因 `LibreSSL SSL_connect: SSL_ERROR_SYSCALL`
失败，未因此修改 DSH 或宣称重新完成 latest 审计。

## 实际故障与修复

1. 原有本机 3000 端口无监听，Web connection refused，飞书也停止服务。私有日志显示官方 SDK 1.73.0
   在握手超时后 removeAllListeners/terminate，触发异步未处理 WebSocket error，整个 Host 退出。
   `websocket-lifecycle.test.ts` 用独立 Node 子进程和不响应升级的本机 TCP server 复现同一异常；
   旧依赖 exit 1，固定为 1.73.3 后 exit 0。无真实凭据或外网请求，不安装全局异常吞噬器。
2. 重启还遇到获取机器人身份的 TLS 连接失败，沿 Adapter apply 使 DSH 插件树加载失败。
   `startup-isolation.test.ts` 通过真实 apply/Runtime 路径、仅替换平台连接，先红后绿。
   只将 platform.connect 拒绝转换为不含 SDK cause 的连接错误；清理后在原 Gateway 注册 degraded 投影。
   配置与 Host 注册错误仍拒绝加载；原生 reload/凭据更新可以重新尝试，无新增后台重试器。
3. 官方 channel.disconnect 在首次成功连接前直接返回；Adapter 用公开 rawWsClient.close 强制停止失败启动的
   socket/retry。对应调用点测试先红后绿，底层真实 socket 的超时行为由独立进程测试覆盖。

唯一 Host、凭据引用、配对授权、Session 历史和模型组成不变；没有新 Tool/Prompt、模型调用或持久存储。
failed transport 随 Cordis dispose 移除。卸载不删除原生数据；旧 pack 与 profile 文件备份保留用于回退，
但旧 SDK 的崩溃风险也会随回退恢复。

## 执行结果与边界

- `pnpm --filter dsh-evoforge-feishu test`：构建成功；默认 checkout 缺少原生 landlock 依赖，另有旧 SDK
  版本断言与超时，9 failed / 51 passed。不能作为支持验收。
- 更新两个 SDK 版本断言后，显式设置 `DSH_EVOLVE_DSH_SOURCE_DIR` 到部署 alpha.5，执行
  `pnpm --filter dsh-evoforge-feishu exec vitest run --maxWorkers 1`：57 passed / 3 failed。
  失败为 dual-workspace、package-install-remove、一个 native-schedule-restart 测试超时；原因尚未关闭。
- 聚焦 startup-isolation、platform-disconnect、websocket-lifecycle、platform、runtime-dispose、package-contract
  六文件：14/14 passed。随后补充“无效配置仍失败”用例，startup-isolation 2/2 passed。
- Feishu typecheck、build、check:docs、check:ci 与 check:suites（15/15）通过；git diff --check 通过。
- 本机安装器 product→web 成功，完成 exact pack 校验、持久化、官方 add 和 post-install dump。
  安装后 SDK 实际为 1.73.3；只有一个 Host 监听 127.0.0.1:3000，未认证 HTTP 401，未绕过认证。
- 实际已有浏览器页面从“无法连接 Host”经 reload 恢复；渠道页显示连接正常、原有 1 条授权、入站/出站各 4。
  这证明 Web/渠道连接与历史恢复，不等于本轮飞书消息收发或复杂任务效果已验证。
- 截图曾被 Mac 锁屏阻止；后续可读取并操作飞书，在原 DSH 对话发送了净支出计算验收任务，期望 73 元。
  随后在真实飞书界面读到机器人回复“73 元”，本轮收发与这一固定简单任务正确性通过；不外推复杂任务效果。

## 当前体验问题清单（按影响）

| 优先级 | 复现步骤与观察 | 当前状态 |
| --- | --- | --- |
| P0 | 长连接握手超时后 Web 和飞书同时不可用 | 已修复并部署，真实 socket 回归通过 |
| P0 | 飞书身份读取连接失败使整个 Web 启动失败 | 已隔离并部署，故障注入通过 |
| P1 | 已授权用户打开控制台→渠道，首屏仍展示“首次连接”、配对表单与入出站计数 | 待改；日常状态和操作不突出 |
| P1 | 重启后连接正常且已有持久收发记录，仍提示确认机器人启用和事件订阅 | 待改；需区分尚无本次连接事件与真正配置故障 |
| P2 | 渠道首屏可见 Adapter、Session、official-feishu-websocket、pending request 与撤销按钮中的内部 id | 待改；中文任务导向文案与技术详情收纳 |
| P2 | 在渠道页刷新整个网页，会回到“运行诊断”子页 | 待确认预期并修复视图选择恢复 |

尚未完成：完整生命周期绿灯、断连现场 UI、实际任务集、独立自我进化效果与 Hermes 同条件比较。
本记录不把上述局部测试数量当作产品效果。
