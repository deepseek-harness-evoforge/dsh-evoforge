# P1.15 Automatic Evolution Budget 契约

> 当前状态：**旧 target 预算已撤销**。内部 author/governance 仍有各自有界预算；本页描述的 P1.14/P1.16 target 预算仅保留历史记录。

> 状态：implemented；默认关闭随 P1.14/P1.16，启用自动 Target 后默认每个 Target 每 UTC 日最多预留 1 次自动尝试

## 用户结果

> 常驻 Agent 即使连续收到大量明确纠正或在付费边界崩溃重启，也不能无限自动消耗 proposer/evaluator-author token；操作者可以在 Commands/Web 解释今天用了多少、还剩多少，原会话始终继续。

P1.15 最初收紧 P1.14 的自动入口，P1.16 作为第二个消费者复用相同的 per-Target reservation 深模块。每次显式 `/evolve feedback … shadow|author …` 或 Web 确认仍是一项新的人工授权，不受自动 cap 限制；Promotion、Retention、Canary 和 rollback 规则不变。

## 最小配置

```yaml
automaticFeedbackTargets:
  - target: plugin-delivery-feedback
    casePackHash: <64-char-content-hash>
    maxAttemptsPerUtcDay: 2
```

`maxAttemptsPerUtcDay` 默认 `1`，范围 `1..20`。它限制“可能进入一次付费边界的自动尝试预留数”，不是实际账单。P1.14 的单次输入/输出 token 仍由 exact Case Pack manifest 限制，因此其日 proposer 上界可解释为：

```text
maxAttemptsPerUtcDay × Case Pack input/output token limit
```

assembled evaluator 自己的模型 usage 必须继续独立报告，不能混入 proposer 上界。
P1.16 的 evaluator author 输出上限固定为 1,600 token，日上界同样是 `attempts × 单次固定上限`；
两类 Target 拥有独立 root/journal，不建立共享池。

## 持久语义

```text
one exact explicit signal
  └─ unique static Target? ──> no: manual
  └─ existing reservation for this Signal today? ──> yes: reuse
  └─ used < daily limit? ──> no: defer until next UTC day / manual remains available
  └─ durable 0600 reservation
       └─ authorized workflow → at most one proposer or evaluator-author request
```

- 预留位于 Target 静态 owned root 的 `.automatic-evolution-budget-v1/current.json`；首次可把尚不存在的 exact root 创建为 `0700`，symlink/root path 拒绝；文件只保留当日最多 20 个条目，UTC 换日时原子替换，长期磁盘状态恒定有界；浏览器和命令不接收或返回路径；
- 预留只含 Target/Skill/Signal id、UTC day 和时间，不含反馈正文、Prompt、Session、模型配置、secret 或价格；
- 同一 Signal 的预留是内容寻址且幂等；进程在预留后崩溃，重启复用额度，不二次扣减；
- 预留后即使启动前失败也不自动退还，因为无法证明付费效果没有发生；操作者仍可显式检查和启动；
- journal 缺失表示未用，损坏、身份不匹配或路径不可信表示 `unknown`，自动入口 fail closed；
- UTC 换日开启新的有界窗口；旧 Signal 即使再次出现，既有 Shadow launch 或 evaluator-author identity 仍阻止重复外部请求；不确定请求绝不自动重试。

## Control Plane 与 KV Cache

`/evolve status` 与 Web overview 只在用户读取时投影每个自动 Target 的 `used / limit / remaining / UTC day / ready|unknown`。没有轮询、通知中心、模型 Tool、Prompt、Skill、system message 或 Session event；普通 Session token 增量为 `0`，完整可缓存前缀不变。

## 非目标

全局/跨插件配额、真实货币价格、provider 账单对账、分钟级滚动窗口、团队共享额度、自动增额、Web 配置编辑、显式人工动作限流、决定哪些 workflow 可自动运行、自动 evaluator qualification 和跨主机 lease 均不进入 P1.15。
