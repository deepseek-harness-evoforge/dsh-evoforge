# 渠道日常使用 UI（2026-09-13）

范围：在 `81a7480` 上改进原生 Control Center 的 Gateway 子视图。唯一 DSH alpha.5 Host、
Gateway Remote、配对授权、撤销确认、凭据和存储均保持不变；无模型组成、权限或持久化格式变更。

## 真实问题与结果

在本机已授权、真实飞书任务回复“73 元”、持久收发各 5 条的会话中打开控制台→渠道：

- 原页面将已完成的“首次连接”占据首屏，当前连接放在计数之后。新版对已有授权的所选渠道隐藏该引导，
  当前连接在计数之前，“需要处理”在计数中排第一。新渠道引导与新用户授权操作保留。
- 协议名 `official-feishu-websocket` 从实体副标题移到折叠详情；主要中文说明去掉 Adapter、Session、
  pending request 等术语。明确连接正常不代表任务已经完成。
- 重启后尚无本次入站事件，只显示中性测试提示，不再让已有正常连接的用户反复检查机器人配置。
- 受控停止唯一 Host，点击刷新，原版告警出现但总状态仍为“就绪”。新版显示“状态已过期”，
  保留的连接用中性“上次状态：连接正常”标记，并隐藏要求发送测试消息的提示。
  重启同一 profile 后，在同一页点击刷新，告警与历史状态标记消失，返回真实连接状态。

以上正常、离线、恢复路径已实际操作并逐次检查可访问树和截图，不仅是组件截图或 DOM 测试。
未撤销真实授权以伪造新用户；新人和配对/撤销分支由既有回归覆盖。原有 1 条授权及收发各 5 条在重启后保留。

## 回归与部署

- 新增日常用户回归，先观察到首次引导仍显示的失败，再修复通过。
- 新增过期状态断言，先失败再修复；上次连接标签与过期时隐藏测试消息提示也纳入断言。
- `pnpm --filter dsh-evoforge-gateway exec vitest run --maxWorkers 1`：133 passed / 1 skipped，11 文件。
- Gateway typecheck、build、check:docs、check:ci 与 diff whitespace 检查通过。
- 原生 installer `--suite gateway --profile web` 仅更新现有 Gateway Bundle，完成持久 exact pack、add、dump；
  没有移除 product 的其他插件。最终 pack id：
  `238baf39fcdc2d9df4dbcbac90e8fd546600e208c1124c93cf99b9f5d4d10824`。
- 使用已有 alpha.5 部署运行时，按 PID/命令验证后 SIGTERM、等待无端口监听，再启动同一 profile；没有第二 Host。
  原 product pack 保留用于回退；插件卸载与 rollback 的 Host 合同未改变。

## 尚未关闭

整页刷新会重置 Control Center 子页选择；配对表单仍常驻、可访问名称中仍有内部 route id；尚未完成
新会话到复杂任务、审批、执行失败与恢复的全面 UX 审计。本次未重跑完整 clean-profile 卸载矩阵，
前一轮 Feishu 三项生命周期超时仍未关闭。不以 133 项测试声明整体产品可日常使用或优于 Hermes。

## 追加：自动发现断线与同页恢复（11:14–11:21）

在 `91288ef` 的实际部署上，停留渠道页并受控停止唯一 Host，不点刷新。
浏览器已有 connection lost/retry，十余秒后渠道页仍显示“就绪 / 连接正常”。
`getByText('状态已过期', { exact: true }).waitFor({ state: 'visible' })` 实际超时。
原因确认于 GatewaySurface：5 秒轮询只读取 pendingPairings，并直接忽略错误，健康快照没有随之更新。

修复仍使用原生 Remote，只在渠道视图挂载期间每 5 秒读取 overview 与 pendingPairings，二者均成功才发布
新快照。失败保留旧值并显式标记过期；恢复自动清除读取告警。后台读取不重置配对输入、撤销确认或操作错误，
不显示手动刷新忙碌态；已有读取尚未返回时跳过后台轮询。手动刷新可取代旧请求，迟到结果不能覆盖新结果；
卸载清除定时器并使未决发布失效。没有新增 Host 服务、权限、持久状态、模型调用或提示词。

验收：

- DOM 回归先在“找不到状态已过期”失败，再通过；覆盖负结果、恢复后的新健康值、待批准列表保留/更新、
  单飞轮询、迟到失败、清除定时器，以及不抹掉用户操作状态。
- 最终完整 Gateway：11 文件，135 passed / 1 skipped；typecheck、build、check:docs、check:ci、diff 检查通过。
- 开发前重新 fetch 官方 master：仍为 `c291e796…` / rc.2；独立审计 checkout clean，frozen install exit 0，
  build exit 0 / passed。运行支持基线仍为未修改的 alpha.5，未声称 rc.2 已全面支持。
- 原生 installer 的 gateway-only add/dump 成功。新持久 pack：
  `7e19f61efd1fcd6ea234f66522c0c0630e3f86bd3172e00fb80705758ed91bfc`。
- 实际加载新包并整页刷新；进入同一渠道页。停止唯一 Host 后，不点刷新即出现“状态已过期”、
  “上次状态：连接正常”及读取告警；截图检查首屏清楚显示历史状态，发送测试消息提示消失。
- 确认端口释放后重启同一 profile；不操作页面，告警自动消失并恢复“就绪 / 连接正常”。
  授权仍为 1，持久入站/出站仍各 5。没有发起新模型任务或改变真实授权。

只声明上述真实断开/恢复路径。5 秒是轮询周期，不是检测时延保证；浏览器定时器节流和未返回的 Remote 请求
仍可能延迟读取。没有重跑完整 clean-profile 卸载矩阵；Host/存储合同未变。原生新会话初始化问题仍见
[Web 任务验收](web-task-outcomes-2026-09-13.zh.md)，不能以渠道页恢复证明整个 Web 会话恢复。
