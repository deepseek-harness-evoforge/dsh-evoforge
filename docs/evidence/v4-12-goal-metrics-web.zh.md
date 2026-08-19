# V4-12：Goal metrics 进入 DSH Web 权威控制面

> 日期：2026-08-19
> 声明等级：`verified`；只证明当前 packed `dsh-evolve` + `dsh-evolve-web` 在真实 DSH Host/Client 中的安全投影、刷新、断连和恢复，不代表真实 provider 价格、因果归因或 Hermes paired 完成

## 实现边界

- `DeliveryOutcomeStore.summarize()` 产生 `all`、`selected`、可选 `baseline` rollup，并保留至多 20 条最新已测 Outcome；
- rollup 区分 measured/unmeasured，缺失 projection 不伪装为零；
- 最近证据只包含 Outcome id、时间、可选 Generation、状态、Goal id/revision、cutoff 与 exact metrics，不包含 Session、call、reason 或路径；
- `EvolutionControlPlane.overview` 深拷贝 browser-safe 形状，Typert 从固定 DSH source 生成 Host/Remote；没有新增 `/metrics` 服务或浏览器权威 store；
- `EvolutionAction` 在没有活动 Generation 时仍显示 `Native DSH` 选择及其真实 Outcome；明确提示 provider price unavailable 和观察值不能证明 Generation 因果；
- Remote 失败时保留最后成功快照并显示 alert，后续成功读取才替换快照。

## Test-first 覆盖

先在公开 seam 写红灯：Store 聚合、Control Plane browser-safe projection、Web 当前/父代/原生 DSH 渲染、
package fixture 的 native metrics bootstrap。绿色实现后又增加“25 条已测 Outcome 只暴露最新 20 条”的显式
边界回归；targeted Store、Control Plane、Web client 与 package contract 全部通过。严格 optional property 边界
不通过 `undefined` 冒充缺失字段。

## 真实安装与原生事件路径

1. 从当前工作树打包 `dsh-evolve-0.1.0-alpha.1.tgz` 与 `dsh-evolve-web-0.1.0-alpha.1.tgz`；
2. 在全新 `DSH_HOME` 中通过官方 `dsh plugin --profile web add <tgz...>` 安装；
3. 用 profile patch 加载两个 packed Bundle 和测试专用 bootstrap；bootstrap 明确 inject 原生 `sessions`，先加载
   `dsh-evolve` 再 create/resume Agent，使 `agent/session-start` 能重放 durable 日志；
4. bootstrap 只通过原生 `session.append` 写入 Goal change、turn/step、Goal-owned message、assistant usage、
   `complete_delivery` call/result、goal complete、step/turn end，并调用原生 `sessions.flush`；它不直写 Outcome store，
   不调用模型，也不冒充真实 provider；
5. 重启时通过 `sessionPersistence.list()` 与 `agents.resume()` 恢复同一 Session；固定 call id 使重放幂等。

该真实路径暴露并修复了三个装配问题：缺少 `sessions` inject、重启时错误 create 导致持久日志 id 冲突、
以及 evolve monitor 晚于 `agent/session-start` 加载导致恢复时漏记。三者均在 fixture/package contract 中固定。

## 真实浏览器结果

DSH Host 运行于本机真实 HTTP 端口，使用 DSH Web 侧栏选择 `EvoForge Browser Acceptance` Workspace，打开
“演化 → 高级”。浏览器看到：

- 当前选择 `Native DSH`，`1` 总计、`1` 通过、`0` 失败、`0` 未知；
- Workspace 与当前选择均为 `1` measured、`0` unmeasured；
- `40` uncached input、`8` output、cache read `30`、cache write `5`；
- LLM `90 ms`、tool `20 ms`、TTFT `20 ms`、active wall `130 ms`；
- `1` attributed turn、`0` closed steps；最近 Goal `goal-evoforge-browser-metrics r2`，cutoff event `12`；
- provider price unavailable；界面没有推断货币成本，也没有声称 Generation 导致这些值。

验证序列：

1. Host 在线点击刷新：数值完全保持，console error 为 `0`；
2. 终止 Host 后点击刷新：显示 `evoforgeEvolution/overview ... Failed to fetch`，最后成功的 1 条 Outcome 与全部
   metrics 仍可见；
3. 使用同一 profile、同一端口重启 Host，再点击刷新：alert 消失，resident 显示运行中；
4. durable Session 被 resume/replay 后仍是 `1` 条 Outcome，不从 `1` 增长为 `2`；全部数值不漂移，console error 为 `0`。

## 未完成门禁

- deterministic native usage 证明投影和恢复，不是一次真实 provider 调用；
- DSH 未投影 provider price，因此货币成本仍不可用；
- 没有 exact Skill invocation 因果链接，不能声称某 Skill 降低 token 或时延；
- Hermes 同模型、同权限、同预算 paired provider cost/cache/latency 与长期 Retention/negative transfer 仍未完成。

## 提交前回归

- 根目录 `pnpm test`：全部插件套件通过；其中 `dsh-evolve` 258 passed / 2 skipped，`dsh-evolve-web` 26 passed；
- `pnpm typecheck`、`pnpm build`、`pnpm check:docs`：通过；
- DSH 固定源码重新生成 Typert：通过且幂等；
- Doctor 原生插件合同：22/22 通过；
- 11 包 clean-profile 安装、dump、boot、dispose、remove：1/1 通过，用时 24.16 秒；
- `pnpm peers check` 仍报告固定 DSH Web/Host peer 图缺口，因此没有记作通过，也不改变本页声明边界。

设计决策见 [ADR-0054](../adr/0054-goal-metrics-subtract-official-projection-cuts.md)，底层 projection 证据见
[V4-11](v4-11-goal-execution-metrics.zh.md)。
