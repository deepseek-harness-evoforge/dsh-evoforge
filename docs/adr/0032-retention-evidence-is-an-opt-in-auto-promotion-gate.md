# ADR-0032：Retention evidence 只作为 opt-in 自动晋升门

## 状态

Accepted，2026-08-17。

## 背景

P1.11 能用一个独立 prior Case Pack 证明 exact Shadow Candidate `retained|regressed|incomplete`，但
报告仍是离线证据。P1.1 的 clear-instruction 自动晋升只检查当前 Case Pack、append-only 范围与
protected-effect 词法提示；它不知道 Candidate 是否删除或冲淡了以前成立的能力。

直接自动运行全部历史 Case 会引入 registry、选择、过期、冲突、预算、Jobs 和恢复协议，尚无数据证明
需要。把 Retention 变成人工审批硬门又会让明确的正向进化等待人工，并违背“人工审查异步、不阻塞原
会话”。显式人工 promote 本身已经是用户授权，不应被新的实验性 policy 偷偷改写。

## 决策

给现有 `autoPromote` 增加可选的 host-only `retentionRoots`：

```yaml
autoPromote:
  skills: [build-dsh-plugin]
  retentionRoots:
    - /absolute/path/to/retention-runs
```

省略或为空保持 P1.1 行为。配置后，自动 policy 必须在这些 owned roots 中找到至少一个与 exact
Shadow run、baseline、Candidate 和 recommendation 匹配的 `retained` P1.11 report；匹配的
`regressed` 优先阻断，只有 incomplete/无证据也不自动晋升。所有原因进入既有 review detail，Candidate
继续留在人工 review，不创建新的审批队列。

同一个 resident supervisor 的 `afterScan` 继续重评 policy：操作者把 P1.11 output 放入配置 root 后，
下一次扫描即可晋升；没有第二个 daemon、事件总线或 Session wake-up。自动 approval 后、activation 前
的崩溃恢复也必须重新校验 policy，避免绕过 Retention。

## 边界

- 只影响 `auto-clear-instruction-v1`；human approve/promote 不改变；
- 不自动挑选 Case Pack、不自动运行 `retain`、不读取 provider secret、不新增模型调用；
- report 只从静态 absolute roots 扫描，Remote/Web/Command 不提交 path；
- normal Session 不新增 Tool、Prompt、Skill、system message 或动态状态；
- malformed/symlink/tampered evidence fail closed，并投影有界 warning；
- 一个 retained report 不是完整抗遗忘证明，多个 Pack 的冲突/过期也不在首片解决。

## 后果

启用该门的用户首次能让“旧能力未回归”成为 clear-win 自我晋升的机器可执行条件；未启用用户没有
迁移成本。代价是当前仍需显式运行 P1.11 CLI，且自动晋升可能因缺证据留在 review。只有真实使用证明
该门有价值后，才考虑用静态 Target + native Jobs 自动发起 Retention。

## 拒绝方案

- **所有自动晋升强制 Retention**：新用户没有 prior Case 时无法使用，属于过重默认。
- **阻断人工 approve/promote**：改变已授权人工边界，且实验性 policy 无法覆盖所有语义。
- **自动回放整个历史**：提前建设 Case 平台和成本调度器。
- **把 retained 文本写进 Prompt/Memory**：污染 KV Cache，且出现文本不等于发布门成立。
