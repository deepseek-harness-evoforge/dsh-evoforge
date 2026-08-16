# ADR-0035：自动进化在可能付费的启动前持久预留预算

- 状态：accepted
- 日期：2026-08-17

自动 Feedback Shadow 的每次 proposer 已有 Case Pack token 上限，但连续纠正仍可产生无界次数的自动付费尝试。每个静态 Target 因此增加一个默认 `1`、最大 `20` 的 UTC 日尝试上限；Automatic Feedback Shadow 在创建 Draft、提交 Job 或触及 proposer 前，先在该 Target 的 owned run root 写入 `0600`、内容寻址的当日预留。每个 Target 只保留一个原子替换的 current-day journal，状态恒定有界。预留先于启动，因此在“已预留、未启动”或“已启动、未回执”处崩溃都不会释放额度；同一 Signal 可复用原预留恢复，新的 Signal 在额度耗尽时转入异步人工路径。Commands/Web 只读取 bounded `used/limit/remaining`，不把预算写入 Session。P1.16 出现第二个真实消费者后，同一深模块也在 evaluator author 前使用其独立 Target root/journal；两类预算不共享额度或动态调度。

选择 attempt reservation 而不是实际 token 账本，是因为 provider usage 只有请求后才能得知，崩溃时还可能未知；把未知当未花费会允许自动重试越过部署策略。单次 token 上限继续由 exact Case Pack 负责，日上限只约束自动入口。显式人工 Shadow 不受此 cap 限制，因为它有新的逐次授权。拒绝全局预算调度器、价格换算、滚动窗口数据库和 Session 内动态预算；journal 损坏时自动入口 fail closed，人工会话继续运行。
