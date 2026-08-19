# P1.18 每 Skill 单未决自动进化门实现证据

> 历史证据：依赖旧 target/Draft 的 inflight gate 已在 V4.24 删除，不是当前产品合同。

> 日期：2026-08-17
> 状态：`implemented`；真实 provider、多日 review-rate/成本数据 pending

## 用户结果与实现

- `automatic-evolution-inflight.ts` 用一个三态纯函数组合既有 durable authority，没有新 store/queue；
- `EvaluatorDraftInbox`、`FeedbackShadowLauncher` 与 `ReviewInbox` 各自投影自己拥有的全量状态；显示用
  的 20 行上限不会隐藏旧的未决工作；
- `FeedbackShadowLauncher` 同时把自己已提交给原生 Jobs、尚未写出首个 durable journal 的 active receipt
  投影为 `busy`，关闭人工 Qualify-and-Shadow 交接中的 pre-journal 付费并发空窗；
- `AutomaticFeedbackShadowService` 与 `AutomaticEvaluatorDraftService` 都在 P1.15 预算预留前检查；
  `busy/unknown` 不创建 Draft、不占额度、不调用 provider；
- evaluator/Shadow 的同一 Signal crash reentry 被豁免，继续复用原 launch/reservation 与 reference-only
  Signal id，并诚实返回 uncertain 或恢复既有无网络阶段；
- 人工 Commands/Web action、原 Session、原生 Goal、Promotion 与 rollback 不变。

## 可复核测试

- 三态组合：全 clear、busy、unknown、authority throw、空 authority fail closed；
- 自动 Shadow/Evaluator：未决时预算与 launch/author 调用均为 0，清除后下一轮继续；warning 不逐轮重复；
- owned facts：pending Review、nonterminal Shadow、unresolved Evaluator 均 busy；reject/incomplete/qualified
  后 clear；损坏事实 unknown；公共 Draft scan 不泄漏内部 Signal id；
- `SIGKILL` evaluator authoring：重启仍复用同一 Signal 与 reservation，provider request 保持 1；
- 真实 DSH 纵向链路：日 cap 明确设置为 2，同一 Skill 产生两条真实 Message Feedback Signal；第一条
  自动生成 inactive Draft 后，第二条在 Draft、qualified Shadow 和 pending Review 整段期间都没有产生
  第二次 author。最终 provider 序列严格为 `author → proposer`，不是 `author → author → proposer`；
  普通 Agent 请求数只随两个用户 Session 增加，host gate 本身没有模型请求。
- 2026-08-19 增补确定性竞态回归：runner 被闸门暂停、`launch()` 已返回 `scheduled` 且 run root 尚无
  journal 时，另一同 Skill Signal 的 `automaticInflightStatus()` 必须为 `busy`；修复前该 126ms seam
  稳定得到 `clear`，修复后转绿，原 fixed-DSH 双 Signal Qualify-and-Shadow 纵向测试也保持通过。

## Cache、权限与限制

- normal Session model surface delta：`none`；预计 token 增量：`0`；
- 新 store/state machine、网络、secret、权限与 UI：`none`；新 Shadow journal 仅增加一个不含正文的
  Signal id 引用；无需浏览器变更验收；
- 这是单机单 resident 自动扫描语义，不是多进程原子锁；显式人工动作可以按新的逐次授权并行；
- 仍缺真实 provider 单位成本、burst correction、review completion time 和多日 resident 数据，不能据此
  宣称完整自治或生产级 exactly-once。

## 本分支实际执行

| 命令 | 结果 |
|---|---|
| focused inflight/Shadow/Evaluator/Review/launcher/resume/crash tests | `8 files / 41 passed` |
| real DSH two-Signal qualify-and-Shadow longitudinal test | `1 passed / 18 unrelated skipped` |
| package add/boot/remove + cache-safe status assembled tests | `2 passed` |
| `pnpm run test:pa1` | Evolve `86` + Delivery `29` + Web `10` + Telegram `22` = `147 passed / 1 skipped` |
| `pnpm -r --workspace-concurrency=1 test` after build | Doctor `5` + Evolve `192` + Delivery `34` + Web `11` + Telegram `37` = `279 passed / 3 skipped` |
| `pnpm run build` | 五个发布包全部成功；Node artifact 与 Typert 校验成功 |
| `pnpm run check:docs` + workspace typecheck | passed |

标准并行 `pnpm run check` 的 Telegram cache-composition lane 在 build 前寻找
`packages/dsh-telegram/dist/index.mjs`，命中仓库既有 clean-tree 竞态；本变更未触及 Telegram。完成全包
build 后，Telegram 独立 `10 files / 37 passed`，并以 workspace concurrency `1` 的全仓测试复核。
