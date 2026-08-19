# ADR-0054：Goal metrics 只减官方 projection cut

固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 已提供 `tokenUsage` 与 `sessionStats` 两个 Session projection。前者对 provider usage chunk/final message 做同 step 替换去重，给出 uncached input、output、cache read/write；后者从 step、assistant 和 tool pair 计算 LLM、tool、TTFT、decode 与 closed-step facts。DSH 没有提供 provider price，因此这些事实不能被换算成虚构货币成本。

`dsh-evolve` 对一个 Delivery Outcome 只统计 exact result event seq 之前的 native Goal-owned turn。一个 turn 的首条 admitted `user/message` 必须指向当时最新且 active 的同一 Goal id/revision；手工 turn、其他 Goal、旧 revision、后续混入另一 Goal revision或缺少 durable Goal change 均不归属。对每个选中 turn，Host 使用 `SessionProjectionRegistry.restore` 沿原生日志单向推进，在 turn 前一 seq 与 turn end/result cutoff 读取官方累计 projection，再做非负差值并合计。active wall time只使用相同 turn 的原生 event time 边界。

可选结果随 compact Delivery Outcome 保存在既有 v2 Domain schema 中；旧记录仍可读取，不建立 transcript、usage event bus 或第二 metrics store。缺少 projection unit、schema 异常、counter 倒退或归属歧义时整个 metrics abstain，Outcome 本身仍可记录。metrics 固定 host-only、非因果，不改变 Opportunity 资格/排序、author 输入、评测 verdict、晋升或回滚。货币成本以 `unavailable/provider-price-not-projected` 明示，后续只能由同 provider、同 route、同预算的真实价格证据补齐。
