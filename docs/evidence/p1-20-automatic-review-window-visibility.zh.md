# P1.20 自动审阅窗口可见性实现证据

> 历史证据：自动 review window/Web 投影已在 V4.24 删除，不是当前产品合同。

> 日期：2026-08-17；分支：`feat/p1-review-window-visibility`

## 结果

Commands 与 Web 现在读取同一个 host 派生投影，显示自动模糊 Candidate 的 exact 审阅窗口和唯一触发
语义。人工、明确 `promote` 与无法证明来源的 Candidate 不获得该字段。Web 详情显式刷新会重读当前
Candidate；候选已被处理时清除陈旧表单并安全失败。

## Red → Green

- Red：P1.19 只有 durable expiry 行为，Commands/Web 无法解释 `eligibleAt` 或触发条件。
- Green：Review Inbox 以既有 policy/provenance/completion facts 派生可选投影，Control Plane、Commands
  和 Web 只格式化同一事实。
- 前端前向失败：新增测试证明原 Refresh 只重读 overview、会保留陈旧详情；修正后 refresh 同时重读当前
  detail，权威读取失败时清除旧表单。
- 反例：human、`promote` 与不完整 provenance 保持无投影；没有浏览器本地倒计时或状态镜像。

## 已执行验证

- `dsh-evolve`：40 files passed / 1 skipped；196 tests passed / 2 skipped。
- `dsh-evolve-web`：2 files / 14 tests passed；包含开放、eligible、陈旧候选和详情刷新分支。
- PA-1 聚合：154 passed / 1 skipped（Evolve 90、Delivery 29/1、Web 13、Telegram 22）。
- 串行完整 workspace：286 passed / 3 skipped（Doctor 5、Evolve 196/2、Delivery 34/1、Web 14、
  Telegram 37）；五包 typecheck、build、文档链接、Typert freshness 与 Node artifact gate 通过。
- 真实 DSH assembled 纵向测试：1 passed / 18 skipped；预置 eligible Candidate，原生 Commands 先显示
  exact eligible 时间，下一条同 Skill automatic Signal 再 durable reject 并继续既有 proposer 路径。
- packed `dsh-evolve`：1 passed；真实 profile `plugin add → boot → plugin remove → native boot` 通过。
- 真实 Chrome：依次验证 open list/detail、eligible list/detail、详情 Refresh 与 stale Candidate 安全失败；
  页面明确显示“无后台 timer，只有下一条同 Skill automatic Signal 触发”；控制台 error 为 `0`。
- Typert 由固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 重新生成；Remote 方法集合
  不变，只增加可选结果字段。
- 标准并行 `pnpm check` 两次分别命中既有 Telegram `dist/index.mjs` clean 竞态和 P1.16 resident
  集成用例的重复 author 抖动；独立重跑分别为 Telegram 37/37、P1.16 1 passed / 18 skipped，上述串行
  全仓门也通过。该分支不修改 Telegram/P1.16 author 路径；远端 Node/macOS Draft PR checks 是并行门的
  最终裁判。

## Cache、权限与限制

- 新模型可见表面、正常 Session token 与新增模型调用均为 `0`。
- 没有 timer、polling、通知、持久字段或新动作；投影可由现有 durable facts 重建。
- 用户刷新只读；P1.19 的 rejection、未来 Session promotion 与 rollback 权限完全不变。
- 尚无真实用户 review-time、误解率或窗口默认值校准数据，因此状态仍是 `implemented`。
