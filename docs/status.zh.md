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
| `dsh-evolve` Shadow 安全门 | `implemented`（P0A 本地退出门通过） | [P0A.1 证据](evidence/p0a-1-owned-path-tracer.zh.md)、CLI 测试、[P0A.8 本地未见首测](evidence/p0a-8-private-heldout.zh.md) | 第三方独立复跑与真实 provider outcome |
| Sealed Trial executor | `implemented`（macOS、已接入确定性 evaluator） | [边界证据](evidence/p0a-2-darwin-sealed-trial.zh.md)、[ADR-0006](adr/0006-fail-closed-sealed-trial-execution.md) | 磁盘配额、Linux/Windows 与任意 Candidate/DSH 组装执行 |
| known-bad / known-correction 校准 | `implemented`（静态示例 + 真实 bridge + 3/3 公开产品 fixture + 本地 held-out） | [P0A.3](evidence/p0a-3-calibrated-paired-trial.zh.md)至[P0A.8](evidence/p0a-8-private-heldout.zh.md) | 更多独立真实 Case 与误报/漏报数据 |
| Candidate 的 `promote/review/reject` 评价 | `implemented`（本地 P0A 退出门通过） | paired baseline/Candidate、真实 composition、纯 Decision；冻结修正首次 held-out 为 `fail → pass` | 落盘重放、真实 provider outcome 与长期 false-promotion 数据 |
| Capability Generation 与 Session pin | `implemented`（P0B.1） | [P0B.1 证据](evidence/p0b-1-generation-release-kernel.zh.md)、真实 DSH Storage/Agent/Skill 测试 | 第三方复跑、更多 DSH 版本与长会话 cache 指标 |
| Git Skill 晋升与回滚内核 | `implemented`（host service + P0C Commands） | exact Git gate、future-session pointer、live Session 不漂移；[P0C.1](evidence/p0c-1-human-release-command.zh.md) 与 [P0C.2](evidence/p0c-2-review-to-inactive-generation.zh.md) | P1 自动晋升与真实 canary 数据 |
| 异步人工复核 | `implemented`（P0C.2） | claim/files/case/cost/限制 projection；reject durable；approve 生成 inactive Generation；真实 Commands/Agent 零模型调用且不阻塞原会话 | 逐行 diff viewer、durable pause/resume、真实用户可用性数据 |
| 单机常驻和崩溃恢复 | `implemented`（P0B） | 四个 release `SIGKILL` 边界；[P0B.2a](evidence/p0b-2a-durable-shadow-resume.zh.md)；[P0B.2b](evidence/p0b-2b-resident-shadow-supervisor.zh.md) native Jobs supervisor/关机恢复/重复扫描 | 生产多日 soak、真实磁盘耗尽与更多机器数据 |
| `dsh-software-delivery` | `planned` | 用户结果和验收方向已定义 | 独立 test-first 实现与 DSH assembled test |
| 个人助理、消息、内容、日程插件 | `planned` | 仅产品范围 | 每次只选择一个高频工作流验证 |
| Web/TUI | `planned` | 交互原则已定义 | 权威 host projection、真实浏览器 E2E |

## 当前可以做什么

- 阅读三项目深度研究与 DSH 插件目录；
- 复用 `build-dsh-plugin` Skill 开发 cache-safe DSH 扩展；
- 运行 Shadow，验证候选越权、预算、active/Case Pack 完整性，以及 macOS 上的校准配对检查；
- 通过 host service 记录 inactive Generation，并在 exact Git tree 校验后为未来 Session 晋升或回滚；
- 使用 `shadow --resume` 继续 durable Candidate/Trial；不确定的付费 proposal 不自动重试；
- 配置 resident supervisor 后，由常驻 DSH 自动继续已落盘、无网络的 Candidate/Trial，并通过原生 Jobs 观察或取消；
- 通过 host-only `/evolve review` 查看 claim/files/case/cost，reject 或批准为 inactive Generation；随后显式 promote/rollback future-session Generation，全程不产生模型请求；
- 在真实 DSH Agent 上让 root/resume/child 固定各自 Generation；pin 或 Git 完整性失败时原生会话继续；
- 审查报告 Schema 的实际 JSON 输出。

## 当前不能做什么

- 不能把 P0C.2 人工复核当作完整控制产品；它尚无逐行 diff viewer、durable pause/resume 或自动晋升政策；
- 不能把公开的确定性示例当作真实 DSH 工作流已经改善；
- `shadow` 不执行任意模型生成代码；assembled lane 会运行真实 DSH，但 Candidate 仍只作为 Skill 数据选择受限的可信 evaluator 行为；
- 不能声称完整持续进化、生产级多日可靠性、任意外部效果 crash-resume 或优于 Hermes；
- 不能作为生产依赖安装。

P0B 的本地实现门已通过；P0C.1/P0C.2 已形成零模型调用的 review → inactive Generation → 显式 future-session promotion 闭环。下一纵切是 durable pause/resume，而不是新的控制平台；生产多日 soak 继续作为发布证据积累，不能被短时自动化测试替代。
