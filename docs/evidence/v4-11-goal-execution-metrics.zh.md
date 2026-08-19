# V4-11：Goal 执行 metrics 使用 DSH 官方投影

> 日期：2026-08-19
> 声明等级：`implemented`；只证明 compact Delivery Outcome 可携带非因果 provider usage/cache/latency facts，不代表完整成本归因、Web 可视化或自进化完成

## 已实现事实

- 只读取 DSH 原生 Session 的 durable Goal change、Goal-owned user message、turn/event time，以及官方 `tokenUsage` / `sessionStats` projection；
- stable Goal id 可跨 revision 合计，但每个 turn 的首条 admitted message 必须匹配当时最新且 active 的 exact revision；
- 手工 turn、其他 Goal、旧 revision、缺 Goal、混合 Goal owner、缺 projection unit 与 counter regression 全部 abstain；
- projection 通过官方 checkpoint rows 单向推进，对每个 Goal turn 的前后累计 cut 做差，不重复解析 provider usage，也不估算 token；
- cutoff 固定为产生 Outcome 的 exact `complete_delivery` result seq，之后追加的 Session 事件不能漂移该记录；
- 保存 uncached input、output、cache-read/write、closed steps、active wall、LLM/tool/TTFT/decode；DSH 未投影价格时货币成本明确 unavailable；
- metrics 是 Delivery Outcome 的可选字段；旧 v2 记录继续可读，Storage restart 后 exact facts 保留；
- metrics 不进入 Opportunity 资格/排序、author 输入、评测 verdict、晋升或回滚。

## Test-first 证据

红灯先固定缺失 projector 与旧 Outcome strict schema 拒绝 `goalMetrics`。绿色测试使用真实 DSH rc.6
Session、SessionProjectionRegistry、TokenMeter 与 SessionStats：其他 Goal 与手工 turn 被排除，目标 Goal 两个
revision 的 turn 被合计；真实完成顺序中的 `goal/change(complete revision+1)` 先于 tool result，不会抹去该 turn
入场时的 active revision 归属；open turn 在 exact tool result 截止，后续噪声不改变结果；缺 unit、缺 Goal
和归属歧义均 abstain。monitor 集成测试从真实 Session event 自动写入 metrics；固定 DSH StorageDomain E2E
验证可选 metrics 在 close/reopen 后保持 exact。

## 2026-08-19 验证记录

- `dsh-evolve` 完整测试：55 files 通过、1 个显式环境文件跳过；257 tests 通过、2 tests 跳过；
- `dsh-evolve` Host/Test TypeScript 均通过；十一包整仓 typecheck 与 build 通过；
- Typert 由固定 DSH source 重新生成并通过 artifact 校验；文档链接与公开路径检查通过；
- `dsh-doctor` 原生插件契约 22/22 通过；
- 十一份最终 tarball 的 clean-profile add/dump/boot/原生 Goal+Tool/dispose/remove/readback 为 1/1 通过，
  用时 25.14 秒。该门证明装配与卸载回归，不冒充 metrics 数值断言；metrics 数值由上述官方 projection
  测试及固定 DSH StorageDomain E2E 证明。

## 未完成门禁

- DSH Web 尚未展示 per-Outcome/聚合 token、cache 与 latency；
- 没有真实 provider price，因此没有货币成本；
- 没有 exact Skill invocation 因果链接，metrics 不能证明某 Skill 降本或提速；
- 同模型/权限/预算的 Hermes paired provider cost、TTFT、cache-read 与长期负迁移数据仍未完成。

设计边界见 [ADR-0054](../adr/0054-goal-metrics-subtract-official-projection-cuts.md)。
