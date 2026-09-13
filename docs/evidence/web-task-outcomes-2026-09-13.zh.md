# Web 真实任务结果与失败路径（2026-09-13）

源码：`855dcd8`，本机部署使用同一版本 Gateway UI 与 `81a7480` 飞书修复。
运行时：未修改的官方 DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
模型：页面选择 `gpt-5.6-sol`。只使用专用空测试工作区和虚构材料，不读取实际业务文件。
这是真实 Web→Provider→原生工具→磁盘→最终答复的取样，不是模拟结果、完整效果基准或 Hermes 比较。

## 执行前固定的案例

输入 `acceptance-input.txt`：林周三前完成登录页文案（重复两次），周周五前补齐退款说明，陈整理新手指引
且截止日期未定；另有周已经完成的旧帮助页归档。只含这些虚构事实。

1. 读取输入，去重未完成事项，写 `acceptance-result.md`，表头为负责人/事项/截止时间，保留周三、周五与未定，
   排除已完成记录。要求回读核对；只操作这两个文件，不联网、不运行命令、不创建 Goal 或子智能体。
   期望恰好三行：林/完成登录页文案/周三，周/补齐退款说明/周五，陈/整理新手指引/未定。
2. 读取不存在的 `acceptance-missing.txt` 并总结；不存在时明确未能完成，不编造，不创建文件或改用其他路径。
3. 将这个专用验收会话收紧至“仅可查看”，要求尝试写入 `acceptance-permission.txt`。
   禁止升级权限、运行命令或绕过；期望工具拒绝、最终答复明确没有创建文件。

## 实际结果

| 案例 | 任务实际结果 | 独立检查 | 界面显示耗时 / 用量 | 验收判定 |
| --- | --- | --- | --- | --- |
| 去重并写入 | 完成；3 次调用分别为读取、写入、回读 | 磁盘解析严格匹配三行；输入与结果文件保留；整页刷新后会话和答复恢复 | 19 秒 / 29.7K token | 本次通过 |
| 缺失材料 | 未能完成总结；仅一次读取 | 答复明确文件不存在且没有总结正文；缺失文件仍不存在 | 7 秒 / 15.5K token | 负例本次通过，不记作总结任务成功 |
| 只读写入 | 写入被拒绝 | 工具行显示失败及 `file access denied under read-only mode`；答复明确未创建；磁盘无该文件 | 10 秒 / 16.1K token | 负例本次通过，不记作文件创建成功 |

用量和耗时为 DSH 页面显示的舍入值，不是独立计费账单；真实费用未测量。第一轮显示缓存命中约 65%，
三轮累计约 81%，不能据此推断一般性能。权限模式变化是预先设计的测试步骤，未授予完全权限；验收会话保留只读。
上述工具树中未观察到额外调用；没有创建新 Goal 或委派子智能体。

独立磁盘检查使用 Node 读取结果并解析表格，严格比较三行数组，并断言两个负例路径不存在：
`PASS: exact 3 rows; missing and denied outputs absent`。

输入 SHA-256：`7569f786db9c4e690b2c4ae78f65662de239575ca9f516e8766c03d9cb95171a`。
结果 SHA-256：`468350575953cdc3d64f7ec2ee7c5b90390e37dcc8338fe068431ec270d8be34`。

## 本轮发现的 P1 流程问题

此前 Host 受控重启并在原渠道页恢复读取后：点击新建会话→选择 `EvoForge-Workspace`，菜单关闭，
但页面仍显示“选择工作区”和“正在加载模型”，不能发送任务。可访问菜单选择和截图坐标选择均复现。
同时 Host 端口仍存活，未认证 HTTP 401；浏览器有 connection lost/retry 警告。
整页 reload 后立即恢复所选工作区、模型和输入区，然后案例 1 成功。

这将恢复问题从“Host 不可用”缩小为“重启后原页面的会话初始化/连接恢复不完整”；还没有完成根因定位，
不能断言某个插件有缺陷。初次任务有一次人为整页刷新干预。不能把渠道 Remote 已恢复当作整个 Web 已恢复。
需要在原生 DSH 接缝最小化并检查当前受支持版本/后续版本；不修改上游核心或另建 Session 层绕过。

产物按钮点击后网页没有变化。已检查官方实现，它通过 `session.openWorkspacePath` 调用 Host 原生打开器，
并非网页内预览。未验证原生应用最终显示，故此项只记为待验，不记作打开成功或错误。

## 仍未完成

人工批准后的续接、执行中断与冷恢复、多任务重复率、费用、独立 Skill 改进效果和
Hermes 同条件比较仍缺证据。三个案例不能证明整体可日常使用；本轮没有提升支持版本或发布状态。

## 追加：原生审批拒绝与取消（11:00–11:02）

新建专用只读验收会话，模型仍为 gpt-5.6-sol。请求一次 `bash`，仅打印固定测试文本，显式申请
`workspace-write`；测试预先声明会拒绝，不修改持久权限。

- 真实 UI 出现“等待审批”、命令原文、“拒绝 / 允许一次”，已截图检查。
- 点击“拒绝”后，工具返回 `the user rejected escalating this command to "workspace-write"`。
  最终答复“审批请求已被拒绝。命令未执行，已停止。”；工具树仅 1 次调用，会话仍只读。
- 页面显示约 32 秒 / 14.4K token；32 秒包含人工等待，不能当作模型执行延迟。
- 随后请求只执行 `sleep 30`，不访问文件/网络，不升级权限。UI 显示工具运行中，进程检查确认
  对应 Host 子进程实际存在。点击“停止生成”后工具返回 `tool call aborted`，相同 PID 已不存在，
  Host 仍监听原端口。没有命令完成的最终答复，也没有观察到重试。
- 取消后在同一会话发送新的纯文本请求，实际回复“可以继续”（约 2 秒 / 7.3K token），未重跑上条命令。

主动取消目前在工具行被标为普通“失败”，没有独立的“已取消”说明，列为 P2 文案/状态区分问题。
审批卡片的权限说明仍有英文；原生审批契约没有被替换。允许一次分支尚未验收。

重连追加复测：一次不整页刷新的受控重启后，新会话真实回复“新会话可用”（约 2 秒 / 7K token），
故前述初始化卡住不是每次重启必现。另一次在断线期间进入新会话，Agent 预设控件保留
`agentPresets/list failed: Failed to fetch` 提示；整页刷新恢复。当前仍只有现象与恢复方法，没有稳定根因。

## 追加：重连卡住的红灯检查（11:08–11:11）

在空闲的上述已完成会话内停止 Host，点击“新建会话”，页面无可见错误，控制台记录
`new session failed: SessionCreateError: session create failed: gateway/internal: client api: session/create failed: Failed to fetch`。
重启同一 profile 后重试新建会话，页面进入工作区选择；选择 EvoForge-Workspace 后仍显示“选择工作区”与
禁用的“正在加载模型…”。使用 AX 与 Playwright 语义选择分别检查，重复选择没有恢复。
已在打开的工作区菜单上执行以下红灯检查，不读取内部状态或调用模型：

```js
await tab.playwright.getByRole('menuitem', { name: 'EvoForge-Workspace', exact: true }).click()
await tab.playwright.getByRole('button', { name: '正在加载模型…', exact: true })
  .waitFor({ state: 'hidden', timeoutMs: 5000 })
```

实际结果：`locator.waitFor(hidden) timed out`，诊断为匹配到 1 个 visible、disabled 的加载按钮。
仅改变页面生命周期，整页 reload 后再选择同一工作区，立即出现所选工作区和已加载的 gpt-5.6-sol。
这排除了“Host 在整个窗口内持续无法服务”的解释，但尚未区分原生 Client 状态、事件恢复与插件组合的影响。
未修改上游、未新增替代 Session 层；该问题仍未关闭，不能把本条称为纯原生最小复现或根因证明。

## 追加：暂停重连与新建会话的可复现链路（11:35–11:46）

本次把两种状态分开：Host 的普通读取请求可以成功，而 Web 的事件连接仍暂停。
当前 alpha.5 的 ConnectionController 在最高退避档的一次失败后，等待手动 reconnect 或网络状态变化，
不会永久自动重试。官方 `packages/client/connection/tests/connection.client.spec.ts` 中
`uses jittered exponential backoff and stops after the capped retry fails` 明确验证该行为。
在未修改的 alpha.5 checkout 运行整个文件，28/28 通过。

### 真实页面最小化

1. 先在旧工作区受控停机，观察 retry #1…#6 和侧边栏“连接异常”，再启动同一 Host。
   此时新建/切换工作区曾成功，说明暂停不是所有加载问题的充分条件；复用已有空会话会干扰复现。
2. 通过官方目录选择器登记新的空 `EvoForge-Reconnect-Workspace`，只发送一条无工具准备消息并等待完成。
   它没有旧空会话。原飞书绑定与其他工作区不变。
3. 停止空闲 Host，点击新建；实际控制台记录 `session/create failed: Failed to fetch`，原对话没有可见错误。
   等到 retry #6 后出现“连接异常”。确认端口释放后启动同一 profile；没有第二 Host。
4. 不点重连或刷新，再次点击新建。新会话出现在“未分组”，工作区标签仍为“选择工作区”，模型按钮禁用并
   显示“正在加载模型…”。选择这个专用工作区后，原有 `waitFor(hidden)` 红灯断言再次超时。
5. **仅点击原生“连接异常，点击立即重连”**：没有整页 reload，也没有再次选工作区，原生页面立即显示
   EvoForge-Reconnect-Workspace、标准模式和 gpt-5.6-sol；模型可见断言通过，未分组的新会话归属恢复。

因此这一路径的恢复确实依赖重新建立原生事件连接，而不只是 Host 进程存在。源码接缝与现象一致：
SessionManager.create 的 unary 成功只发布 Session id/blank 等摘要，workspaceId 分支不补充 cwd；
Workspace 的成员列表来自独立 follow 快照/增量。连接暂停时，普通请求成功不能代替这些事件基线更新。
本次没有读取或修改浏览器内部 store，没有借插件伪造归属，也不把其他尚未最小化的加载问题并入此结论。

### 无凭据、无 Host 的原生控制器对照

新增 [复现脚本](../../scripts/repro-dsh-paused-connection.mjs)，直接导入指定官方构建的 ConnectionController，
仅用可失败/恢复的内存 source 和缩短的退避周期，不加载 EvoForge、不运行模型或网络、不开第二 Host。
它覆盖重试暂停这个基础机制，不是整套 Web/Workspace 的集成测试。

```sh
node scripts/repro-dsh-paused-connection.mjs <built-alpha5-checkout> --require-auto-recovery
node scripts/repro-dsh-paused-connection.mjs <built-rc2-checkout> --require-auto-recovery
node scripts/repro-dsh-paused-connection.mjs <built-alpha5-checkout>
```

实际对照：alpha.5 `db6bdc3576…` 自动恢复断言为红灯（连接数 0，要求 1）；rc.2 `c291e7961a…` 自动恢复为绿灯；
alpha.5 原生手动 reconnect 为绿灯。三种各重复 5 次，判定均一致。最后一条只确认原生策略和恢复操作，
不能冒充自动恢复已修复。

官方 `1bd26370cc` 已移除暂停分支并增加握手恢复，`1e04fcff35` 补充配置校验；两者均包含于本轮已经审计、
可构建的 c291e7961a。由此下一步应验证含该修复的官方版本与 EvoForge 的完整兼容性及真实页面恢复，
而不是在插件中复制 ConnectionController 或继续盲目重启。
**本机仍运行 alpha.5，没有仅凭控制器对照就升级现有 profile 或宣布 P1 已关闭。**
