# 当前实现状态

> 更新日期：2026-08-15

本页是仓库完成度的权威入口。架构文档描述目标和约束，不等于能力已经实现。

## 状态词

| 状态 | 含义 |
|---|---|
| `planned` | 只有需求或设计，没有可运行实现 |
| `implemented` | 源码和自动化测试已经落地，但尚未获得真实环境/未见样本证据 |
| `verified` | 达到对应路线图退出门，证据可由第三方复核 |
| `released` | 已发布版本、安装与卸载路径均通过验证 |

## 能力矩阵

| 能力 | 状态 | 现有证据 | 进入下一状态还缺什么 |
|---|---|---|---|
| DSH/Claude Code Rev/Hermes 调研 | `verified` | [研究索引](research/README.zh.md)、固定 revision 与源码定位 | 上游 revision 改变时重新审计 |
| DSH 171 原生插件目录 | `verified` | [全量目录](research/deepseek-harness-native-plugins.zh.md) | 新 revision 重新生成统计 |
| `dsh-evolve` P0A.1 safety tracer | `implemented` | [P0A.1 证据](evidence/p0a-1-owned-path-tracer.zh.md)、6 条 CLI 测试 | 第三方复跑及完整 P0A evaluator |
| Sealed Trial executor | `implemented`（macOS 原语） | [边界证据](evidence/p0a-2-darwin-sealed-trial.zh.md)、[ADR-0006](adr/0006-fail-closed-sealed-trial-execution.md) | 接入 Shadow、磁盘配额、Linux/Windows 适配与真实 Candidate Trial |
| known-bad / known-correction 校准 | `planned` | [P0A 契约](architecture/p0a-shadow-contract.zh.md) | 真实 fixture、selection 与未见 final-test |
| Candidate 的 `promote/review/reject` 评价 | `planned` | Decision 规则已有设计 | paired Trial、校准和可重放 Decision |
| Capability Generation 与 Session pin | `planned` | [进化架构](architecture/evolution-design.zh.md) | P0A 先证明 evaluator 有价值 |
| 晋升、回滚与异步人工复核 | `planned` | 路线图 P0B/P0C | immutable Generation、崩溃测试、控制面 |
| 单机常驻和崩溃恢复 | `planned` | Local Continuity 需求已冻结 | P0A 退出后实现 durable state machine |
| `dsh-software-delivery` | `planned` | 用户结果和验收方向已定义 | 独立 test-first 实现与 DSH assembled test |
| 个人助理、消息、内容、日程插件 | `planned` | 仅产品范围 | 每次只选择一个高频工作流验证 |
| Web/TUI | `planned` | 交互原则已定义 | 权威 host projection、真实浏览器 E2E |

## 当前可以做什么

- 阅读三项目深度研究与 DSH 插件目录；
- 复用 `build-dsh-plugin` Skill 开发 cache-safe DSH 扩展；
- 运行 P0A.1 测试或 Shadow tracer，验证候选越权、预算和 active Skill 完整性边界；
- 审查报告 Schema 的实际 JSON 输出。

## 当前不能做什么

- 不能让 `dsh-evolve` 自动修改或晋升 active Skill；
- 不能把一次 `reject` safety tracer 当作 evaluator 已经可靠；
- `shadow` 尚不能安全执行任意模型生成代码；macOS 隔离原语还没有接入该命令；
- 不能声称已经持续进化、可回滚、长时常驻或优于 Hermes；
- 不能作为生产依赖安装。

下一条产品退出门是：evaluator 稳定拒绝 known-bad，并让至少一个真实修正在未参与搜索的 final-test 上胜过 baseline，同时 active Skill、sealed cases 和正常 DSH composition 均不被污染。
