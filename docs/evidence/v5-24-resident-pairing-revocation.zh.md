# V5.24：resident pairing 精确撤销与 Web 控制面

- 日期：2026-08-25
- DSH：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- 基线：`main` 的 V5.23 提交 `b391938`
- 状态：实现、自动化与真实最终包 Web 展示通过；真实用户 grant 未执行破坏性撤销

## 产品缺口

V5.22 已实现 resident DM→code→Host approval，但 Host 还没有撤销动态 principal grant 的产品动作。管理员只能
保留授权或直接修改存储/配置；这不满足可视化身份治理，也无法证明用户撤销后下一条消息会重新停在 Agent 前。
撤销不能删除原生 Workspace/Session，也不能误删静态配置 route。

## 实现

`dsh-gateway` 的同一 Pairing Storage Domain 现在把 active grant 原子改写为 `revoked` tombstone，保留 grant、
request、route、批准时间与首次撤销时间。重复撤销同一 tombstone 返回原始时间并标记 `alreadyRevoked`；未知或
静态配置 route fail closed。撤销后 exact endpoint 不再匹配，下一条陌生私聊重新产生短期 code，仍不会进入
Agent；原生 Workspace、Session、历史事件和模型配置保持不变。

Gateway 在 mutation 期间先隐藏动态 route，阻止新的入站 dispatch 和 paired outbound ownership；若该 route
仍有活动 ingress 或处于 prepared/sending/retrying 的 outbound effect，则拒绝撤销而不是假装已经静默。公开
Typert Remote 只接受一个 route id，返回脱敏的 Workspace/Session、首次撤销时间与幂等状态。

DSH Web 新增“授权路由”权威列表。静态 route 只显示“静态配置”，动态 grant 才提供撤销动作；第一次点击只
进入二次确认，第二次才调用 Host Remote。成功后刷新快照并提示下一条私聊将重新收到 code。该视图和动作均不
调用模型，也不创建 Session Command、Gateway CLI 或第二套权限系统。

## 自动化检查

- `pnpm --filter dsh-gateway test`：8 files / 32 tests passed；
- `pnpm --filter dsh-gateway typecheck`：通过；
- `DSH_SOURCE_ROOT=<pinned-dsh-checkout> pnpm generate:typert`：固定 rc.2 生成成功；
- `pnpm --filter dsh-gateway build`：Host、Client、Typert freshness 与 Node artifact 检查通过；
- authority 测试覆盖 grant→revoked、route/match 消失、幂等撤销和重新 offer；Gateway assembled 测试覆盖动态
  route 撤销后消息不进入原 Session、重新 pairing，以及静态 route 拒绝；Remote/Web 测试覆盖三方法合同和
  两步确认。

## 真实最终包与浏览器

从当前源码打出的 `dsh-gateway-0.1.0-alpha.1.tgz` 已经由官方
`dsh plugin --profile web add` 原位升级到现有 rc.2 `web` profile，并完成正常 Host 停止/冷启动。升级前的真实
动态 route、Workspace、Session、ingress/outbound journal 与飞书 transport 均恢复。

真实 DSH Web 显示：

- 1 条 `feishu` 动态配对 route、1 个实时 Session；
- `official-feishu-websocket: ready`；
- ingress 3、outbound 3、pending 0、uncertain 0、failed 0；
- 动态 route 有“撤销”按钮，第一次点击变为“确认撤销”；刷新恢复初始按钮。

本轮没有执行第二次确认：当前 route 属于项目所有者正在使用的真实飞书授权，目标没有授权中断它。因而本文
证明最终包的展示、两步防误触和冷启动兼容；真实平台上的 grant 撤销→新 code→重新批准仍是后续显式破坏性
验收项，不能由自动化测试冒充。
