# V5.22：常驻 Gateway 配对与真实飞书连接证据

- 日期：2026-08-25
- DSH：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- EvoForge commits：`3d910af`、`615abd1`、`adb7f34`、`1ce0140`、`85ffdc5`
- Hermes current：`057dcdf236f8a6a26721c10fcc6ccb72726e272a`

## 验证对象

本纵切验证的是 DSH 插件，不是独立 Bot Runtime：`dsh-gateway` 常驻持有 pairing/grant authority，
`dsh-feishu` 在 Cordis Bundle boot 建立官方 WebSocket。陌生私聊必须先授权，第一条消息不进入 Agent；
管理员从 DSH Web Host 控制面把 code 批准到当前 native Workspace/Session，下一条消息无需重启即可 dispatch。

Hermes 对照事实和未照搬缺口见
[current source audit](../research/hermes-gateway-pairing-current-2026-08-24.zh.md)。旧 Session
`/feishu-pair start|status|cancel`、两分钟 listener、反向短语、静态 YAML 与浏览器倒计时已从 runtime、client
和测试删除，ADR-0045 已由 ADR-0098 取代。

## 自动化结果

- `dsh-gateway`：32 tests / 8 files；typecheck、build、Typert generated-artifact gate 通过。
- `dsh-feishu`：44 tests / 17 files；typecheck、build 通过。macOS assembled case 使用真实 DSH boot、Storage
  Domain、Workspace、Session、Agent、Commands 和 fake platform，证明 boot 即连接、任意首条 DM 回 10 位 code、
  首条不写 `user/message`、Host approval 后第二条进入同一 Agent、连接不中断且 dispose 只 disconnect 一次。
- pairing code 使用加密随机无歧义字符；持久层只含 salted SHA-256；过期、重放和跨 account 同码歧义
  fail closed。Grant 与 pending request 位于同一 Storage Domain table 的原子 update 中，重开 authority 后 exact
  endpoint 仍匹配。
- Gateway Web Remote 在 Host 侧校验 Workspace status、Session ownership、live Agent 与 cwd，再从 native Agent
  读取 preset/provider/model；浏览器不传这些能力参数，也不调用模型。

## 最终包与真实浏览器

从 `main` 打包 `dsh-gateway-0.1.0-alpha.1.tgz` 和 `dsh-feishu-0.1.0-alpha.1.tgz`，通过官方
`dsh plugin --profile web add` 安装到本机 `$DSH_HOME/profiles/web`；`dump-config` 显示两个 Bundle 均启用，
Feishu 为 `mode: pairing`、空 `routeIds`。真实 DSH Web 返回 HTTP 200，浏览器加载的 Gateway 面板显示：

- Gateway `ready`；
- 当前 native Workspace/Session 是批准目标；
- 飞书配对 code 输入与“批准飞书配对”操作可见；
- 零 route 时 `feishu / official-feishu-websocket / ready` 仍可见；
- 视图声明且实测不调用模型。

真实 Host 当前由最终 tarball 常驻运行。App ID/Secret 只经启动进程环境注入，未写 profile、仓库、证据或
日志；标准 HTTPS proxy 由 Adapter 进程局部采用。

## 真实平台消息与重启结果

真实飞书私聊已完成 resident pairing 的人工纵切：陌生用户首条任意消息只收到短期 code，未进入 Agent；
管理员在 Gateway Web 把 pending request 批准到当前 native Workspace/Session 后，不重连、不改 profile，
后续三条真实消息均进入同一原生 Session，并各自收到一次飞书回复。其中覆盖普通文本、原生 `/new`
Command 和新的普通文本 turn。

批准后的 Gateway 权威面显示一条动态 route、一个 live Session、`official-feishu-websocket: ready`；journal
为 ingress 3、outbound 3、pending 0、uncertain 0、failed 0。当前 Command palette 保留只读 `/feishu`
健康命令且不再暴露 `/feishu-pair`。Session 中仍可见的旧 `/feishu-pair` 卡片是改造前已经持久化的历史
事件，不是当前 runtime 命令或可调用入口；本次验收没有改写原生 Session 历史。

随后对真实 Host 发送正常终止信号并从同一 profile 冷启动。重启后 exact 动态 route、live Session、
3/3 journal 和 transport `ready` 均从持久状态恢复，没有要求重新配对，也没有重复投递已有消息。该结果
证明 grant、Session 绑定与 Gateway journal 的干净重启恢复；尚未用重启后新增飞书消息关闭持续收发门。

## 尚未关闭的门

真实 DM→code→Host approve→native Session→回复的主路径已通过，但这还不是 AS-2 全部门禁。仍需在上述
冷启动后发送一条新消息证明持续收发无需重新配对，并验证真实一次性 Approval 卡片、官方 Schedule
create/dispatch 回送、group policy、网络/429/模糊发送故障、精确撤销和长期重连。完成前 AS-2 真实平台
退出门仍是 `partial`，也不创建发布 tag。
