# 当前实现状态

> 更新日期：2026-08-16

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
| `dsh-evolve` Shadow 安全门 | `implemented` | [P0A.1 证据](evidence/p0a-1-owned-path-tracer.zh.md)、CLI 测试 | 第三方复跑及完整 P0A evaluator |
| Sealed Trial executor | `implemented`（macOS、已接入确定性 evaluator） | [边界证据](evidence/p0a-2-darwin-sealed-trial.zh.md)、[ADR-0006](adr/0006-fail-closed-sealed-trial-execution.md) | 磁盘配额、Linux/Windows 与任意 Candidate/DSH 组装执行 |
| known-bad / known-correction 校准 | `implemented`（静态示例 + 真实 bridge + 2/3 产品 fixture） | [P0A.3 静态证据](evidence/p0a-3-calibrated-paired-trial.zh.md)、[P0A.4 assembled 证据](evidence/p0a-4-dsh-assembled-shadow.zh.md)、[P0A.5 cache-safe 证据](evidence/p0a-5-cache-safe-status.zh.md)、[P0A.6 lifecycle 证据](evidence/p0a-6-dispose-owned-watcher.zh.md) | 最后一个产品 fixture 与本地未见 final-test |
| Candidate 的 `promote/review/reject` 评价 | `implemented`（三个确定性 assembled case） | 同一 CLI 报告中的 paired baseline/Candidate、真实 composition 指纹与纯 Decision；两个产品 case 都拒绝虚构净改进 | 多 case margin、落盘重放与真实 provider outcome 验证 |
| Capability Generation 与 Session pin | `planned` | [进化架构](architecture/evolution-design.zh.md) | P0A 先证明 evaluator 有价值 |
| 晋升、回滚与异步人工复核 | `planned` | 路线图 P0B/P0C | immutable Generation、崩溃测试、控制面 |
| 单机常驻和崩溃恢复 | `planned` | Local Continuity 需求已冻结 | P0A 退出后实现 durable state machine |
| `dsh-software-delivery` | `planned` | 用户结果和验收方向已定义 | 独立 test-first 实现与 DSH assembled test |
| 个人助理、消息、内容、日程插件 | `planned` | 仅产品范围 | 每次只选择一个高频工作流验证 |
| Web/TUI | `planned` | 交互原则已定义 | 权威 host projection、真实浏览器 E2E |

## 当前可以做什么

- 阅读三项目深度研究与 DSH 插件目录；
- 复用 `build-dsh-plugin` Skill 开发 cache-safe DSH 扩展；
- 运行 Shadow，验证候选越权、预算、active/Case Pack 完整性，以及 macOS 上的校准配对检查；
- 审查报告 Schema 的实际 JSON 输出。

## 当前不能做什么

- 不能让 `dsh-evolve` 自动修改或晋升 active Skill；
- 不能把公开的确定性示例当作真实 DSH 工作流已经改善；
- `shadow` 不执行任意模型生成代码；assembled lane 会运行真实 DSH，但 Candidate 仍只作为 Skill 数据选择受限的可信 evaluator 行为；
- 不能声称已经持续进化、可回滚、长时常驻或优于 Hermes；
- 不能作为生产依赖安装。

下一条产品退出门是：evaluator 稳定拒绝 known-bad，并让至少一个真实修正在未参与搜索的 final-test 上胜过 baseline，同时 active Skill、sealed cases 和正常 DSH composition 均不被污染。
