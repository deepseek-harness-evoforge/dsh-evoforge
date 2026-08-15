# dsh-evoforge

[dsh-evoforge](https://github.com/deepseek-harness-evoforge/dsh-evoforge) 是 DeepSeek Harness EvoForge 的首个公开 Suite。项目只增加可独立安装、可删除的新能力，不 fork DSH，也不以插件修补 DSH Core Defect。

研究和设计基线已经完成，当前进入 `dsh-evolve` 的 P0A Shadow 实现。长期目标是成为 Hermes 的可验证上位选择：同时覆盖可靠软件交付、通用个人助理、消息与日程、可充分交互的人类控制面，以及可证明的持续进化。软件开发交付是第一个可客观评测的试验场。

## 当前决策

- 复用 DSH 原生 Goal、Session、Storage、Approval、Jobs、Skills 和插件生命周期。
- 不增加 Mission、通用任务 DAG、平行 Runtime 或第二套审批系统。
- KV Cache 稳定是所有插件的第一设计约束。
- 状态、审批、时间线、证据、成本和回滚优先显示在 host/UI control plane，不为界面便利持续改写模型前缀。
- 先用离线 Shadow 实验证明 evaluator 能拒绝坏候选并识别真实改善，再建设在线 Generation、晋升和崩溃恢复。
- 明确胜出的纯指令候选未来可自动晋升；代码、权限和外部副作用只生成 commit/Draft PR 或进入人工审批。

## 仓库边界

默认先在 EvoForge Suite 内按 `packages/*` 组织相关插件。只有插件拥有独立发布或信任边界、明显不同的依赖/许可证，或可以被用户完全独立采用时，才拆为 `deepseek-harness-evoforge/<plugin>` 独立仓库。详见 [ADR 0005](docs/adr/0005-evoforge-repository-boundaries.md)。

## 文档入口

1. [需求基线](docs/requirements.zh.md)：项目所有者已确认的范围、授权和交付顺序。
2. [领域语言与不变量](CONTEXT.md)：实现和评审必须保持的统一术语。
3. [产品架构](docs/architecture/evoforge-product.zh.md)：Hermes Replacement Target、能力边界、交互、可靠性、缓存与仓库策略；[Hermes 上位目标验收记分卡](docs/architecture/hermes-replacement-scorecard.zh.md)规定何时才允许声称某个工作流更好。
4. [自进化架构](docs/architecture/evolution-design.zh.md)：当前唯一自进化方案与分阶段验证路线；[P0A Shadow 契约](docs/architecture/p0a-shadow-contract.zh.md)冻结首个测试接缝、隔离和 evaluator。
5. [插件目录](docs/plugins.zh.md)与[接口规范](docs/plugin-contract.zh.md)：哪些能力成为插件，以及每个发布物的验收合同。
6. [路线图](docs/roadmap.zh.md)：从 Shadow evaluator 到 Local Continuity、交互闭环和有限自治的退出门。
7. [研究索引](docs/research/README.zh.md)：DSH、171 个原生插件、Claude Code Rev、Hermes 及公开自进化项目的一手证据。
8. [ADR](docs/adr)：缓存、Goal、上游边界、旗舰方向和仓库边界的精简决策。
9. [DSH 插件开发 Skill](skills/build-dsh-plugin/SKILL.md)：从用户结果、接缝选择和红测试到缓存、权限、卸载与发布证据的可执行流程。

## 当前下一步

按 [P0A Shadow 契约](docs/architecture/p0a-shadow-contract.zh.md)实现离线 `dsh-evolve shadow <skill-dir>`：以 `build-dsh-plugin` 为首个真实 Skill，建立独立 final-test、生成并评测候选，但不改变 active Skill。Shadow 不能证明真实价值时停止扩张。
