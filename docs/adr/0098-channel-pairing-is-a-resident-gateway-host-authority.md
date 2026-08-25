# ADR-0098：渠道配对属于常驻 Gateway Host 权威

- 状态：accepted
- 日期：2026-08-25
- 取代：[ADR-0045](0045-feishu-pairing-ui-reuses-session-commands.md)

## 背景

旧 `dsh-feishu` 通过当前 Session 的 `/feishu-pair start|status|cancel` 临时启动两分钟 listener，要求用户
把 DSH 生成的短语发到飞书，再复制静态 route、改 profile 并重启。这与真实消息入口相反，也把渠道身份
授权错误地塞进 Session Command。Hermes current source（固定 revision `057dcdf236f8a6a26721c10fcc6ccb72726e272a`）
证明更清楚的入口是：Gateway 常驻；陌生私聊在 Agent 之前收到 code；管理员从 Host CLI/Dashboard 批准；
下一条消息才进入 Session。Hermes 的多 JSON 文件写入、授权非事务和重复 DM 静默缺口不应照搬。

## 决定

`dsh-gateway` 是唯一配对权威，`dsh-feishu` 是常驻 Adapter：

1. Bundle boot 即注册 `pairedRoutes` transport/outbound 并连接官方飞书 WebSocket；没有 route 时也保持连接并
   显示 redacted `ready/degraded/stopping` 健康状态。
2. 未信任私聊先调用 Gateway `authorize()`。首条消息被消费，不下载附件、不创建 Agent、不写 Session；
   群聊不发 code。Gateway 返回高熵短期 code，持久层只保存 salted digest。
3. 管理员在 DSH Web 的 Gateway Host 控制面粘贴 code。Remote 校验当前 Workspace 拥有选中的 live native
   Session，并从该 Agent 读取 preset/provider/model；单表原子更新把 pending request 变为 exact trust grant。
4. Grant 立即供 resident Adapter 使用且跨 Host 重启恢复；无需改 profile、切 mode 或重启。当前 Session
   版本和历史消息不变，只有批准后的未来消息进入该 Session。
5. 动态 grant 只能由 Gateway Host 精确撤销。Pairing Domain 原子保存 revoked tombstone；撤销期间 route
   不接收新的 ingress/outbound ownership，有活动 effect 时拒绝而不是宣称完成。静态 route 和原生
   Workspace/Session 不属于该 mutation；撤销后的下一条私聊重新创建 pending request。
6. Feishu Client Module 只保留已绑定 Session 的只读 `/feishu` 健康视图；配对批准和动态 grant 二次确认撤销
   统一位于全局 Gateway 控制面。旧 Command、临时 listener、短语/YAML/倒计时 UI 与测试全部删除。

## 结果

- 普通用户只需给机器人发送任意私聊；不需要进入 DSH、选择路径、拼命令或查平台 ID。
- Host 操作者明确选择 native Workspace/Session 后批准，proposer/模型/Adapter 都没有授权写权限。
- code 一次性、限时、按 account 有界；多 account 同码歧义、过期、重放、无 live Session、Workspace
  ownership/cwd 漂移全部 fail closed。
- Adapter lifecycle 仍由 Cordis dispose；Gateway Storage Domain 是 pairing/grant 唯一持久权威。
- revoked tombstone 保留首次撤销时间并支持幂等 receipt；Web 只对动态 grant 显示撤销动作，静态 route 只能
  通过配置生命周期修改。
- 静态 routes mode 仍供预配置部署和独立内容权限使用，不是首次配对后的必需迁移步骤。

## 拒绝方案

- Session `/feishu-pair` 或 Goal/Agent Tool：身份授权发生在 Agent 之前，不能依赖被授权对象。
- 用户首条消息直接创建 Session：未授权内容会进入 Agent，且目标 Workspace 不明确。
- Adapter 自己保存 allowlist：复制 Gateway authority，无法与 route/persistence 原子一致。
- 撤销时删除 native Session 或修改静态 route：把外部 principal authority 与 DSH 原生历史混为一体。
- 有活动平台 effect 时强制撤销并宣称精确取消：无法证明已进入外部 API 的效果没有发生。
- 浏览器直接改 profile 或运行时 Git 分支：扩大 client 权限并要求重启。
- 完整照搬 Hermes pairing store：保留其跨文件非事务、跨进程 lost-update 和静默限流缺口。
