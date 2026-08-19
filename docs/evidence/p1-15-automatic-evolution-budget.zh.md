# P1.15 Automatic Evolution Budget 实现证据

> 历史证据：本页的静态 target 预算已在 V4.24 删除；内部 author/governance 预算是另一当前合同。

- 日期：2026-08-17
- 状态：`implemented`；本地 deterministic、真实固定 DSH 组合与真实 Chrome 已通过，真实 provider 长期成本仍待验证

## 用户结果

Automatic Feedback Shadow 不再只有“每次最多一个 proposer”而缺少长期总次数边界。每个静态 Target 现在有默认 `1`、最大 `20` 次/UTC 日的自动 attempt cap；操作者可从 `/evolve status` 或 Web 读取 used/limit/remaining。额度耗尽、journal 损坏或路径不可信只停止自动入口，原 Session 不等待，显式人工 Shadow 仍可逐次授权。

## Test-first 行为证据

实现前的失败测试依次证明：

1. 不存在 durable budget owner，同一天第三个 Signal 在 `2/日` 配置下仍会进入 launcher；
2. 进程重启会丢失内存尝试集合；
3. Commands、结构化 Remote 与 Web 均看不到长期自动成本边界；
4. Web 无法解释 journal `unknown` 时自动入口已 fail closed。

最终 `AutomaticEvolutionBudget` 在可能创建私有 Draft、提交 native Job 或触及 proposer 之前，先写一个 `0600` 的原子 journal。测试覆盖：

- 同一 Signal 幂等且只占一个 reservation；
- 1/2、2/2、额度耗尽和 next-UTC-day reset；
- 新实例读取同一 journal，证明不是进程内计数；
- journal 损坏、系统时钟倒退和 journal 目录 symlink 均 fail closed；
- Target/path/limit 歧义拒绝；
- journal 只含 Target/Skill/Signal id 与时间，不含纠正文、Prompt、Session、模型 route 或 host path；
- 每个 Target 只有一个最多 20 项的 `current.json`，跨日原子替换，长期磁盘状态恒定有界。

## 真实 DSH 与付费边界

固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 的 assembled Agent 测试使用本机确定性 HTTP proposer，完成：

```text
negative feedback + correction
→ durable budget reservation
→ private Draft
→ automatic feedback Shadow
→ exact Retention
→ future Generation
```

proposer 请求恰好 `1`；预算 journal 在请求前存在且不含 correction；原 Session 继续固定 baseline Generation，普通 Agent request 数不因预算控制面增加。测试没有读取 secret 或调用付费 provider。

## Commands、Web 与浏览器

同一 `budgetStatus()` owner 被 Commands 与 `EvolutionControlPlane` 投影；Typert Remote 只返回 Target id、Skill、UTC day、used、limit、remaining 与 `ready|unknown`，不返回路径或 reservation id。

真实 Chrome 使用产品 React 组件与产品 CSS 打开 Evolution 面板，确认：

- `Automatic evolution budget` 显示 `plugin-delivery · build-dsh-plugin`；
- 显示 `1/2 attempts used · 1 remaining · 2026-08-17 UTC`；
- 既有人工 Evaluator action 仍存在；
- 控制台 error 数为 `0`，没有新增配置或审批工作流。

最终 `pnpm check` 通过：Doctor 5/5、Software Delivery 26 passed / 1 skipped、Telegram 37/37、Evolve 177 passed / 2 skipped、Web 10/10；共 255 passed / 3 skipped。文档链接、全部 typecheck/build、生成式 Typert source digest、纯 Node artifact 与 `git diff --check` 同时通过。首次全仓并行复跑遇到既有 Telegram fixture 的一次 `dist` 清理竞态，独立 37/37 与随后完整 `pnpm check` 均通过；没有为 P1.15 修改 Telegram 或 DSH 行为。

## KV Cache、权限、持久状态与卸载

- 模型表面变化：`none`；无 Tool、Prompt、Skill、system message 或 Session event；
- 正常 Session token 增量：`0`；预算只在 resident scan 或显式 status/overview 时读取；
- 自动付费权限：只收紧 P1.14 已显式启用的部署策略；默认 cap 为 `1/日`；
- 人工权限：不变；显式 Shadow 仍要求每次确认；
- 持久状态：每个自动 Target 的 owned run root 增加一个 bounded current-day journal；
- 卸载：journal 是插件 owned evidence；Bundle/插件移除不向 DSH Session 或配置留下新 owner。

## 未证明

Attempt cap 不是 provider 账单、货币价格或精确 token 计量。日 proposer 理论上界仍需结合每个 exact Case Pack 的 input/output limit；assembled evaluator 若自己调用模型，usage 单独报告。当前证据不证明真实 provider 的单位成本、长期 cap 命中率、陌生用户配置成功率、生产多日稳定性或跨主机共享额度。
