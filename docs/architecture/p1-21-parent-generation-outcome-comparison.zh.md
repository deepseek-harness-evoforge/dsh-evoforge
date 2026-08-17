# P1.21 父版本交付结果对照

## 用户结果

P2D.1 已能回答“当前版本最近产生了多少 passed/failed/unknown 交付结果”，但用户仍要自己翻历史才能
回答更重要的问题：“它和直接父版本相比怎样？”P1.21 在 `/evolve status` 与 Web 中并列显示 active
Generation 和其 parent（或 native DSH）的观察计数，并明确标注：这些是描述性数据，不证明版本导致了
差异。

它帮助用户决定是否继续观察、人工审查或回滚，但不自动作出任何 release 决策。

## 最小契约

`DeliveryOutcomeStore.summarize` 仍只扫描已有、最多 1000 条的 P2D.1 紧凑记录。同一次遍历产生：

- `all`：全部保留样本；
- `selected`：当前 active Generation 的样本；
- `baseline`：该 active Generation 的 exact `parentId`，没有 parent 时为 native DSH 样本。

只有存在 active Generation 时才请求和显示 `baseline`。Commands 从同一摘要显示完整 id；Web Remote
只增加一个可选的四计数字段，并复用现有 active/rollback identity 显示短 id。刷新仍是用户显式读取，
不建立历史快照或浏览器状态。

```text
existing bounded Delivery Outcomes
             │ one host scan
             ▼
      all / active / parent
             │
       Commands + Web
             │
  descriptive counts + causal disclaimer
```

## 为什么只显示计数

active 与 parent 可能处理了不同难度、不同数量和不同时间段的任务。直接计算“提升百分比”、排名或自动
回滚会制造伪精确。P1.21 因此只显示 exact 三态计数；真正的自动回滚继续使用 P1.2 的相同 sealed Case
Pack 反事实门。样本少、任务组合不同或外部服务波动时，用户必须把结果视为观察线索。

## 简洁性、缓存与权限

- 不新增 outcome、表、索引、timer、watcher、模型调用、Command、Tool、Skill、Prompt 或动作；
- 只给既有有界内存遍历增加一个 counter bucket，时间仍为 `O(retained outcomes)`，空闲成本为零；
- 不复制 Prompt、消息、仓库路径、PR 正文或 check 输出；
- 正常 Session 请求、Tool Schema、Skill catalog 与顺序变化为 `0`，模型 token 增量为 `0`；
- 观察结果不 publish、promote、rollback、merge、release、部署或改变权限；
- baseline 缺失或 0 条也是如实计数，不被解释成 pass、fail 或改进。

## 非目标

- 不做因果推断、A/B 流量路由、统计显著性、排行榜或模型 judge；
- 不因交付计数自动晋升或回滚；
- 不扩大 P2D.1 的隐私字段或持久保留上限；
- 不把不同任务分布下的通过率差异宣传为“优于 Hermes”。
