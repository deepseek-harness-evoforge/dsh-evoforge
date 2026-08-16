# AS-1：Telegram 单私聊 Adapter 实现证据

> 日期：2026-08-17；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；状态：implemented，尚未达到与 Hermes paired benchmark 的 verified/better 门

## 用户结果

一个离开浏览器的用户可在一个明确允许的 Telegram 私聊中继续同一个稳定 DSH Agent；该 Agent
的普通回答、原生 Goal 后续轮次和原生 Schedule 轮次回到同一私聊。Slash Command 走 DSH 原生
Commands，受保护动作可用一次性 Telegram 按钮回答。

## 已通过边界

- 33 个纯契约测试覆盖 exact private chat/user、确定性 update identity、64-byte callback、Bot API
  请求体、token 不进入错误结果、受保护 route 配置、delivery transition、at-most-once command
  admission、单调 command checkpoint 与 10,000 条终态 journal 硬容量边界；
- 真实 DSH Loader + Agent Loop + 两步 bash Tool 轮次把最终回答送回 loopback Telegram server；
- 同一固定 DSH 分别在原生配置和启用 Adapter 时抓取完整模型 request，除不可序列化 AbortSignal 外
  逐字段完全相等，且 request 中无 Telegram 字样；因此正常 Session 的实际模型表面增量为 0；
- 第一次 `sendMessage` 返回明确 `429 + retry_after` 后只做一次有界安全重试并落为 `delivered`；
- 同一真实装配中，`approval/request` 的一次性 allow callback 返回 `allowed-once`，随后调用
  `answerCallbackQuery`；
- `/telegram` 经原生 Commands 执行并直接返回，Session 记录原生 `command/run`；
- 真实 JSON Storage Domain 跨进程重开后，把崩溃前 `sending` 记录变为 `uncertain`，没有盲目重发；
- packed tarball 完成 `dsh plugin add`、native config dump、启用后的 Loader boot、dispose 和
  `dsh plugin remove`；Bundle 默认 disabled，避免未配置身份和秘密时误启动；
- 插件注册 0 Tool、0 Skill、0 system prompt；真实状态命令同时报告这一模型表面。

当前 package suite 总计 `10 test files / 37 tests` 全绿；其中所有声明真实 DSH 的 case 都固定到本页
revision，不以 mock Context 代替装配证据。

## 诚实限制

- 自动化使用 loopback Bot API server，没有使用真实 Telegram Bot/真实公网故障；
- 尚无多日常驻、24 小时 update retention、真实移动端时延或陌生用户安装数据；
- Telegram 不提供 `sendMessage` 客户端幂等键，因此 transport timeout 与 crash-in-send 只能标为
  `uncertain`，不能宣称 exactly-once；
- 还没有与同配置 Hermes Telegram Gateway 做 paired 成功率、重复率、token、人工步骤和恢复对比；
- 当前只支持一个 Bot、一个 private chat、一个 user 和一个稳定 Agent/Session id。

因此当前声明只能是 `implemented`。完成真实 Bot soak、崩溃故障注入、陌生安装和 Hermes paired
benchmark 后，才可把 AS-1 提升为 `verified` 或 `better for Telegram private-agent workflow`。
