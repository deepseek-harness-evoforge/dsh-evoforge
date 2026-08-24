# ADR-0096：Generation 选择后的 Outcome 窗口有界且不作因果判断

状态：accepted

## 决策

`EvolutionControlPlane.overview` 在现有 Generation 选择历史上投影只读的 post-selection Outcome window。每个窗口从该选择事件的 `recordedAt` 之后开始，到下一条选择事件的 `recordedAt` 之前结束；两个边界都严格排除。恰好落在边界上的 Outcome 只计为歧义，不进入任何效果桶。若相邻选择事件的 wall-clock 时间不是严格递增，整个窗口 `abstained`，不得按 sequence 猜测时间归属。

窗口只读取现有 `DeliveryOutcomeStore` 的有界保留事实，并按 Outcome 自身的 Session-pinned Generation 分为 `selected`、`previous` 和 `other`。三个桶分别聚合 passed/failed/unknown、不同 Goal 数，以及已测/未测 turns、steps、token、cache、latency 和 active wall；缺失 provider price 继续明确为 unavailable。`previous` 和 `other` 是必要事实：选择只影响未来 Session，已经固定的 Session 可以在选择之后继续产生旧 Generation 的 Outcome。

该投影固定声明 `coverage: bounded-retained-evidence`、`causalClaim: none`、`mutationAuthority: none`。它不生成 Candidate，不改变评测、Retention、晋升或回滚资格，也不自动触发 Canary。Control/Web 不建立新 Store、事件总线、Session、Goal、Runtime 或 writer；浏览器只显示 Host 权威投影。

## 理由

V5.10 已能回答“谁在何时改变了 future-Session selection”，但不能回答选择后保留下来的真实结果分布。把现有 Outcome 与不可变选择事件按严格时间窗口关联，可以形成长期监测的最小可验证底座，同时保留当前 Session 固定版本和 bounded retention 的事实边界。将其限定为描述性上下文，避免把时间相关性冒充 Candidate 效果或让观察面获得发布权。

## 拒绝的方案

- 新建独立 analytics 数据库、日志平台或 Evolution Runtime；
- 只看当前活动 Generation，丢弃仍在运行的 previous/other Session；
- 把边界相等或时间倒退的 Outcome 强行归入某个 epoch；
- 从窗口计数自动生成 Candidate、晋升、回滚或效果 verdict；
- 把有界保留数据称为完整历史、因果证明或 Hermes paired benchmark。
