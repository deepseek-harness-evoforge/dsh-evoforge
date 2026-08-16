# EvoForge 插件目录

> 状态：设计目录；只列有独立用户结果的插件，不把内部流水线阶段计为插件

## 已进入路线图

| 插件名 | 用户结果 | 首个阶段 | DSH 复用 | 模型可见面 | 默认仓库 |
|---|---|---|---|---|---|
| `dsh-evolve` | 从真实任务结果产生 inactive Skill Candidate，独立评测、异步复核，并以人工或最窄 opt-in policy 为未来 Session 晋升/回滚 | P0A + P0B + P0C implemented；P1.1 clear-instruction auto promotion implemented；canary/自动回滚待完成 | Skill、Session、Goal、Feedback、Storage、Jobs、Commands、FS、Shell、Approval、Token Meter | 无新增 Evolve Tool/Prompt；active Generation 复用原生 Skill catalog/body，并按 Session 固定 | `dsh-evoforge` |
| `dsh-software-delivery` | 把原生 Goal 交付为隔离、遵循仓库规范、验证过的 commit 和可选 Draft PR | P2 产品化；P0A 只使用最小 evaluator fixture | Goal、Session、FS、Shell、Sandbox、Approval、Workflow | 优先复用已有工具；不为状态展示新增模型工具 | `dsh-evoforge`，成熟后可独立采用 |

`dsh-evolve` 内部的 Observer、Candidate Lab、Trial Runner、Decision、Release、Monitor 和 Generation Binder 不是独立插件。它们只有组合起来才产生一个用户结果，拆开只会增加配置、版本和缓存理解成本。

`dsh-software-delivery` 对不启用进化的用户仍有完整价值，因此是第二个插件，而不是 `dsh-evolve` 的私有 evaluator。

## 尚未进入路线图的候选

| 候选 | 进入条件 | 为什么现在不建 |
|---|---|---|
| `Control Center` | 至少 `Evolve` 与另一个插件需要同一状态投影，并且 CLI/Web 两个 Adapter 已证明公共契约 | P0C 先由 `Evolve` 自己提供 command/view，避免预建 UI 平台 |
| `Goal Continuity` | 真实长任务证明需要跨进程继续同一原生 Goal，且缺口不是 DSH Core Defect | 先验证 DSH 原生 Persistence/Goal/Jobs 能否组合满足，不创建 Mission 或第二 Goal |
| `Assistant Adapter` | 一个消息、日程、内容或个人助理工作流同时具备高频需求、明确权限边界和可验证 outcome | 不复制 Hermes 巨型 Gateway；一次只验证一个场景 |
| 独立 Optimizer Adapter | 简单 patch proposer 无法覆盖 P0A，且 GEPA 或其他优化器在相同 evaluator 上产生净收益 | 候选搜索不是产品护城河；首版不发布抽象接口 |

## 明确不创建

- Cache 插件：Cache Contract 是所有插件的硬约束。
- Mission、Work Item DAG 或通用 Supervisor：继续使用 DSH Goal。
- 第二套 Memory、Session、Approval、Policy、Event Store 或 Agent Runtime。
- Observer、Promoter、Rollback、Evaluator 等单步骤浅插件。
- 以修复 DSH Core Defect 为主要价值的兼容插件。

## 拆仓规则

插件默认放在 Suite。只有独立发布/维护周期、独立信任边界、明显不同的重型依赖或许可证、或者无需 Suite 其余能力即可完整采用时才拆仓；详见 [ADR 0005](adr/0005-evoforge-repository-boundaries.md)。

首个 GitHub 仓库名与插件包名已经冻结为 `dsh-evoforge` 和 `dsh-evolve`。P0A 本地退出门已通过；npm 尚未发布，发布前仍需完成面向用户的安装验收、打包校验和版本策略。
