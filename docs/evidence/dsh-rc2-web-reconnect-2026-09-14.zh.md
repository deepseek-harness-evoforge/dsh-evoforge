# DSH rc.2 原生 Web 长断线恢复验收

- 时间：2026-09-14 00:56–01:03，Asia/Shanghai。
- EvoForge 起点：`8b113cbe6bac69bb1ad67be90335f18fa790e607`，原有五项用户改动保留。
- 实测 DSH：clean、已构建的 `c291e7961a515f6d7af9304e7fd1d257929aef26` / `0.1.5-rc.2`。
- 结论：此前 alpha.5 的“较长断线后停止自动重试、新会话模型持续加载”复现场景，在本次 rc.2 原生 Web
  中恢复成功。没有修改 DSH，也没有实现第二套连接控制器。
- 限制：隔离 profile、模拟 LLM、纯文本消息；不是现有产品部署升级，也不是真实模型任务效果证明。

## 隔离与固定输入

使用新的 `DSH_HOME`，一个空工作目录，以及
`scripts/fixtures/native-reconnect-web.mjs`。该未打包 fixture 仅通过原生服务注册一个确定性模型和一个原生
Workspace；不创建 Session、不伪造事件、不增加 Tool 或网络调用。Session 创建、发送、执行结果、重连和
历史读取全部由实际 Web 与 DSH Host 完成。

测试 overlay 的结构如下，路径占位符须替换为测试者拥有的绝对路径：

```yaml
- id: agent-default-model
  config:
    provider: reconnect-fixture
    model: reconnect-fixture
- id: llm-deepseek
  disabled: true
- id: llm-pi-ai
  disabled: true
- id: session-title-llm
  disabled: true
- insert:
    - id: evoforge-native-reconnect-fixture
      name: <repo>/scripts/fixtures/native-reconnect-web.mjs
      config:
        dshSourceDir: <built-c291e796-worktree>
        workspacePath: <isolated-empty-workspace>
```

先用相同 `DSH_HOME` 和 `--patch` 执行 `--dump-config` 核对配置，然后启动官方 CLI 的 web profile。
全程仅复用 `127.0.0.1:3000`：确认旧 Host 空闲，停止并确认端口释放后才启动隔离实例。
既有用户 profile、凭据、授权和 Session 数据没有交给 rc.2。认证启动 URL 仅用于打开本地页面，不进入证据。

## 实际步骤与观察

1. 在同一个浏览器标签加载 rc.2；侧边栏显示 `0.1.5-rc.2-c291e79`。
   选择 `EvoForge rc2 Reconnect` 工作区，默认模型为 `reconnect-fixture/reconnect-fixture`。
2. 发送“独立重连验收：只回复准备完成。”。原生执行完成，显示 1 轮 1 步；工作区只有这个已完成会话，
   没有可复用的旧空白会话。
3. 00:57:21 停止唯一测试 Host；点击原生“新建会话”，页面保留旧会话，显示
   “连接中断，正在自动重试，点击立即重连 / 自动重连中”。
4. 保持离线超过旧版停止重试的窗口；00:58:57 启动同一个隔离 profile，约 96 秒后恢复服务。
   **此区间及恢复后没有刷新页面、重新认证或手动点击重连**。同一页面自行显示“连接成功”。
5. 点击“新建会话”：工作区、预设和模型正常出现，没有持续“模型加载中”。发送
   “断线恢复后新会话验收：确认能够完成这条消息。”，原生消息完成，显示 1 轮 1 步。
6. 通过侧边栏打开重启前的会话，旧输入和旧回复仍在。发送
   “继续重启前的会话，确认历史保留且这条消息可完成。”，显示两组消息和 2 轮 2 步。
   实际截图核对了版本、两个会话和旧会话的两轮消息。

模拟模型的固定回复为“原生会话已完成重连验收消息。”；界面显示的 token 和耗时来自 fixture，
不能作为真实任务成功率、模型成本、响应速度或 Hermes 对比证据。

## 恢复原部署与仍未关闭的门

停止 rc.2，确认端口释放，再用原来的 alpha.5 程序和原来的 `DSH_HOME` 启动一个 Host。
重新认证并加载原页面后，实际确认侧边栏版本回到 `0.1.2-alpha.5-db6bdc3`，原工作区和 `gpt-5.6-sol`
模型选择恢复。这不是对迁移过的数据做二进制降级：两个 profile 的数据一直隔离。

上一日曾因 Mac 锁屏暂停，本次解锁后才完成上述步骤。初次切换 profile 时仅刷新会保留旧页面，
经新实例的认证启动入口重新加载后才继续；这与已固定的“同 profile 重启自动恢复”试验分开记录。

原生 rc.2 修复在真实页面得到验证，但现有部署仍使用 alpha.5，高优先级问题的**部署关闭**尚未完成。
剩余门包括 rc.2 依赖和类型基线、完整产品 profile 的审批与渠道回归，以及
[跨版本历史与降级风险](dsh-rc2-upgrade-compatibility-2026-09-13.zh.md)要求的数据级恢复方案。
不能用本次无凭据、模拟模型的原生页面结果代替这些门。
