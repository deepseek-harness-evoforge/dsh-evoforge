# AS-2 飞书 Channel Adapter 实现证据

> 日期：2026-08-17；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；状态：implemented；真实 App 凭据、机器人身份请求、WebSocket 握手与原生 DSH Web 配对向导已验证，exact route 消息闭环和 Hermes paired benchmark 尚未完成

`dsh-feishu` 是 `dsh-channel-router` 上的第二个薄 Adapter，不是独立机器人 Runtime。它使用飞书官方 Node SDK `1.73.0` 的 WebSocket 长连接；Router 持有 endpoint → Workspace/Session/Agent、原生 Command admission 和 ingress 幂等，Adapter 只持有协议、Approval 卡片与出站 journal。

## 已执行链路

- 真实 DSH Boot、WorkspaceRegistry、Agent preset、Session persistence、Agent Loop 和 cli-mock provider；
- 未授权 user 无 Session 输入或平台回复；授权文本生成 `channel:<sha256>` 原生 User Message，并把最终 Assistant answer 回复到 exact chat/message；
- `/feishu` 只执行一次原生 Command；原生 Goal/Schedule continuation 在单 route Session 主动投递；
- DSH `approval/request` 生成一次性飞书卡片 nonce，只有 exact chat/operator 的首个 action 可返回 `allowed-once`/`rejected`；
- 发送意图先写 `evoforge_feishu` StorageDomain；明确 rate-limit 先记录 `sending`，有界重试后 `delivered`；传输模糊失败和 crash-recovered `sending` 均为 `uncertain`；
- Cordis dispose 注销平台 handler、取消 pending Approval、停止 worker、关闭 domain 并断开连接；
- packed `dsh-channel-router` + `dsh-feishu` 通过干净 profile 的官方 add、dump-config、官方 SDK 依赖解析与 remove。

联合门禁还在**同一个真实 DSH Host** 中注册两个真实目录为两个 Workspace，加载实际 Router、Telegram Bundle 与飞书 runtime：Telegram 与飞书分别创建 `telegram-session`/`feishu-session`，其原生 `session.header.cwd`、WorkspaceRegistry `sessionIds`、User Message、Command、Approval 和 continuation 全部保持分离；错误飞书 operator 不能消费另一个 Workspace 的 Approval。Host dispose 后以同一 persistence/StorageDomain/config 冷启动，两个 Agent 各自恢复，重放同一 Telegram update 和飞书 message 不新增 turn 或对外投递。另一条完整 composition 门同时启用 Router、Telegram、飞书与 evolution attention，将两个 Workspace 的 provider request 分别与原生双 Agent 控制组逐字段比较，结果均 byte-equivalent；route、App 与 attention 动态值未进入请求。

当前包回归为 `14 files / 38 tests`（包含 setup-only 配对、Client Module/组件、剪贴板拒绝降级、连接失败清理、取消后重开、单渠道、代理选择、双 Workspace macOS assembled、完整渠道 composition 与 package lifecycle）；Router 的独立合同与 Telegram cache parity 继续通过。官方协议依据是[事件订阅概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)、[官方 Node SDK](https://github.com/larksuite/node-sdk)与[发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。

## 真实 App 连接复验

用户提供的 App ID/Secret 仅通过关闭终端回显的进程标准输入送入一次性验收进程；源码、配置、文档、
命令行、测试输出与仓库均未持久化凭据。第一次在宿主既有代理环境中连接时，官方 SDK 在鉴权请求发出前
由旧代理链抛出 `ERR_INVALID_PROTOCOL`；在同一进程中只绕过代理后，机器人身份请求与 WebSocket 握手
约 `2.7s` 成功，证明凭据、机器人身份接口和长连接能力有效，也把故障限定为传输适配而非 App 配置。

Adapter 随后增加进程局部的标准 HTTPS proxy 适配：选择 `HTTPS_PROXY`/`https_proxy` 或
`ALL_PROXY`/`all_proxy`，遵守 `NO_PROXY`/`no_proxy`，为官方 SDK 的 HTTP 与 WebSocket 路径复用
同一局部 Agent，并关闭 Axios 的隐式环境代理；它不修改进程环境或全局 Agent。单元测试覆盖小写代理、
空小写变量向有效大写变量回退、`NO_PROXY` 直连和不支持协议的 fail-fast。保留宿主原有代理环境的真实
Adapter 首次重跑约 `2.8s` 成功；整仓回归后的最终复验约 `0.8s` 成功，随后完成 typecheck、build、
packed tarball 内容检查；加入原生 Web 配对后的当前回归是 `14 files / 38 tests`。exact 凭据对全部
tracked/untracked 仓库文件的
不回显扫描匹配数为 `0`。

## 零基础 exact identity 配对

要求用户自行查找 `chat_id/open_id` 会让真实可用性停在文档层。`dsh-feishu` 因此在同一 Bundle 内增加
显式 `mode: pairing`，不是新增 CLI、网站或 Runtime。用户在准备绑定的原生 DSH Workspace/Session 中
运行 `/feishu-pair start`；模块从该 Session 解析唯一 Workspace、Agent preset、provider/model，打开
两分钟官方 WebSocket，并只接受首条完全匹配的 80-bit 一次性短语。私聊可直接发送；群聊还必须
`@机器人`。无关消息、附加文本、重放、其他 Session 查询和超时事件全部 fail closed。

匹配后 Adapter 只回复一次确认并立即断开；`/feishu-pair status` 输出完整、带引号、可人工审查的 Router
与 Adapter YAML。它不会把消息 dispatch 给 Agent、写 profile、创建 route 或启用权限；配置只有由部署者
写回 profile、关闭 pairing mode 并重启后才生效。fake transport 单元测试与真实 DSH assembled Host
证明外部配对消息没有新增 `user/message`，Command 自动使用当前 Workspace/Session 且 dispose 断开连接。
真实 App、保留宿主代理的 official pairing transport 启动/取消复验约 `0.8s` 通过，同一实例的
启动→取消→再次启动→再次取消也通过；本次尚未让真实
用户发送配对短语，因此仍不把它声明为 exact route 消息闭环。

## 原生 DSH Web 配对向导

`dsh-feishu` 的同一个发布包同时包含 Host Bundle 与 browser half；`dsh.client` 让 DSH Module Loader
把后者组合进原站 `sidebar.footer.action`。入口只在当前 Session 的 Command descriptor 含
`feishu-pair` 时出现，因此普通 routes mode 不增加 setup surface。页面不建立 Remote、API、存储或
后台轮询，只调用现有 `/feishu-pair start|status|cancel`，本地倒计时只是提示，Host 两分钟窗口仍是唯一
权威。生成结果只显示一次性短语；匹配后才显示待审查 YAML，浏览器不能写 profile 或扩大权限。

最终 `dsh-feishu-0.1.0-alpha.1.tgz` 与 Router tarball通过官方 `dsh plugin --profile web add` 安装到全新
profile；安装测试同时核对 `dist/client.js`、Module Loader wrapper、侧栏 slot，并在 remove 后确认包目录
消失。随后启动固定 DSH revision 与真实飞书凭据，在原生 Workspace/Session 中用真实浏览器完成：

1. 侧栏只出现一个“连接飞书”入口，页面保持在 DSH Workspace/Session shell；
2. 向导显示三步新手说明，生成真实 120 秒配对窗口和格式正确的一次性短语；
3. “复制短语”出现成功反馈，浏览器剪贴板与页面短语完全一致；Clipboard API 被拒绝的路径另由组件
   测试证明会降级为选中 textarea 复制；
4. “取消本次连接”返回“没有创建或修改任何 Router route”，短语从 DOM 消失；
5. 浏览器 console error 为 `0`，Host 退出后连接由 Cordis lifecycle 释放。

浏览器验收没有向飞书发送用户消息，也没有写入 route/profile；它证明新手配对操作已成为原生 DSH
插件体验，但不能替代下一步由用户在窗口内发送短语所产生的 exact 平台身份与消息闭环证据。

## 尚未证明

- 真实用户尚未在有界窗口发送配对短语，因此仍未取得获准测试的 exact `chat_id`/conversation id 与
  发送者 `open_id`，没有声明真实 `im.message.receive_v1`、回复、Command、Approval 卡片或主动提醒已闭环；
- 尚未测多日自动重连、真实移动端延迟、飞书权限撤销和 Hermes 同场景 paired outcome；
- 因此只能声明第二 Adapter 已实现，不能声明生产可用或已经上位 Hermes。
