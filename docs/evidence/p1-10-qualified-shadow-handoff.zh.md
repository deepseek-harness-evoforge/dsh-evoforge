# P1.10 Qualified Shadow Handoff 实现证据

> 历史证据：Qualified Draft handoff 已在 V4.24 删除；当前 Shadow 只消费内部 exact Candidate。

> 声明等级：`implemented`。本页证明 Qualified Case Pack 可以在新的显式授权后进入既有 Shadow；
> 不声明真实 provider 改善率、陌生用户可用性或生产多日可靠性。

## 用户断点

P1.9 资格验证成功后，Pack 位于 host 私有目录。让用户复制该路径、改成静态 `shadowTargets` 再重启，
会把一次连续操作变成部署工作，也可能泄露 host topology。P1.10 只增加一个动作：

```text
/evolve evaluator <64-char-qualified-draft-id> shadow
```

Web 中对应 `Start Qualified Shadow`。两者都只提交 draft id；host 从 P1.9 journal 恢复 signal、Skill、
qualified directory 与 exact hash。

## 最小实现

- Evaluator Target 可选增加 `shadowRunRoot`，且必须 exact 属于 `supervisor.runRoots`；
- `EvaluatorDraftInbox.startShadow()` 只接受 `qualified`，并在委托前复核 Draft 与 Pack hash；
- `FeedbackShadowLauncher.launchExact()` 只接受预声明 target/Skill/run root 和完整 qualified hash；
- launcher 在 provider 前重新计算 Pack hash，`runShadow()` 在实际运行前再次检查，关闭 handoff 的
  TOCTOU 窗口；
- 后续完全复用 P1.8 的 launch id、原生 Jobs、journal、resume、scan、calibration、paired Trial 与
  review，没有第二套 Qualified 状态机或 daemon；
- Commands、Remote、Web 只委托 exact id，未新增模型 Tool、Prompt、Skill 或 system message。

## 自动化证据

核心测试覆盖：

- 非 qualified Draft 拒绝，provider/launcher 调用为 0；
- qualified/draft hash 漂移拒绝，provider 调用为 0；
- 未预声明或 run root 不匹配的动态 target 拒绝；
- 相同 active/terminal launch 复用同一 receipt/journal，runner 只调用一次；
- Web Cancel 不调用 Remote，Confirm 只传 exact draft id，且不调用 Promote；
- packed install/remove 配置包含 `shadowRunRoot`；
- 配置开关前后真实 DSH 普通 Agent model request 完全相等。

真实纵向测试使用固定无密钥 HTTP Adapter 生成一个 Evaluator Draft，经人工 exact-hash approve 后在
macOS sealed runner 完成真实 DSH qualification，再通过新动作进入同一个 Shadow：先校准
known-bad/known-correction，再执行一次 proposer 和 paired Trial，最终进入既有 review。断言整个链路
只有 `author` 与 `proposer` 两次模型请求，普通 Agent 请求数、active Skill 与 Generation 均不变。

```text
pnpm --filter dsh-evolve exec vitest run \
  test/feedback-shadow-launcher.test.ts \
  test/evaluator-draft-inbox.test.ts

pnpm --filter dsh-evolve exec vitest run \
  test/generation-binder.e2e.test.ts \
  -t "generated Qualified Pack|complete native model request"

pnpm --filter dsh-evolve-web exec vitest run \
  test/evolution-action.client.test.tsx
```

P1.10 没有新恢复执行器：精确 handoff 被单元测试证明进入同一个 `runShadow`；已有
`shadow-resume.e2e.test.ts` 与 supervisor `SIGKILL` 契约继续覆盖 proposal-pending 不重试、
Candidate/Trial 可恢复、终态不重复执行。此处不把继承相同 seam 写成一套重复恢复实现。

## 真实浏览器

浏览器 acceptance bundle 在真实 Google Chrome headless 中以 qualified Draft 启动，依次完成：

```text
Inspect Evaluator → Start Qualified Shadow → Cancel
                  → Start Qualified Shadow → Confirm → Recent Shadow run
```

Cancel 前后 `startEvaluatorShadow` 调用均为 `0`；Confirm 后恰好为 `1`，页面显示 `prepared` recent
run。Author/Approve/Reject 调用均为 `0`，console error 与 uncaught page exception 均为 `0`。该测试
验证真实 DOM、React event、确认框和异步刷新，不把 jsdom 结果冒充浏览器证据。

## KV Cache 与成本

- 正常 Session：新增 Tool/Prompt/Skill/system message 为 0，额外 token 为 0；
- 列表、detail、qualification、Cancel：模型请求为 0；
- Confirm：最多复用一次既有 Shadow proposer 请求，预算由 Case Pack 约束；
- 状态只在 host control plane 按打开/刷新/动作读取，无轮询；
- 没有 Mission、Workflow DAG、Memory、Case 服务或第二个 Agent runtime。

## 仍未证明

- 真实 provider 对真实用户纠正的 Candidate 改善率与单位改善成本；
- 陌生用户能否正确区分 Author、Qualify、Start Shadow 三次授权；
- 陌生独立操作者的浏览器可用性复跑、生产多日 soak、磁盘耗尽及 Linux/Windows sealed backend；
- 自动 author、自动 qualification、自动 Shadow 均刻意不实现。

设计契约见 [P1.10](../architecture/p1-10-qualified-shadow-handoff.zh.md)，决策见
[ADR-0030](../adr/0030-qualified-case-packs-enter-shadow-only-through-a-new-explicit-action.md)。
