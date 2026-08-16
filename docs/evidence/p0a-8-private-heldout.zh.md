# P0A.8：本地未见 Case Pack 首测证据

> 状态：P0A 本地退出门通过；允许开始 P0B 红测试，不等于持续进化、真实模型提案质量或 Hermes 全面替代已经完成
> 日期：2026-08-16

## 用户结果

受管 `build-dsh-plugin` Skill 原先没有明确说明如何发布依赖 DSH/Cordis 的 out-of-tree 包。冻结 Candidate 新增一个真实包装规则：宿主提供的 DSH/Cordis 包同时放入 `peerDependencies` 与 `devDependencies`，不能放入生产 `dependencies`；并检查 pack、安装、启动、删除与原生恢复。

这不是 DSH Bug workaround。即使 DSH 完全正确，第三方插件作者仍需要正确声明宿主依赖，避免发布第二份 Cordis 运行时，并保持本地类型检查可复现。

## 时间顺序与不可变性

1. `07:57:19Z`：在看到 held-out 内容前冻结 Candidate；active Skill SHA-256 为 `d392456…10c5`，delta 为 `16f781…e9ed`，拼接后的 Candidate 为 `3d75e6…c243`。
2. 随后才编写本机 Case Pack，用 known-bad/known-correction 做 evaluator 校准；Candidate 未参与该预检。
3. `08:02:52Z`：Case Pack 冻结，tree hash 为 `b3c315…7aed`。
4. `08:04:27Z`：第一次基础设施调用在校准清理阶段因目录权限 `EACCES` 返回 `incomplete`，尚未执行 Candidate Trial。原报告保留；只恢复目录写权限，没有改变任何 Case Pack 文件，tree hash 仍为 `b3c315…7aed`。
5. `08:05:10Z`：执行首次真正的 Candidate paired Shadow。运行前后 Case Pack hash 相同，active Skill 在运行期间不变。

final-test evaluator 没有发送给 proposer。固定 transport 会在请求中发现任一私有 check name 时主动失败；本次请求只包含 active Skill 与 search evidence，请求 SHA-256 为 `92e61f…75a6`。

## 首次 Candidate 评估结果

| 项目 | 结果 |
|---|---|
| Run | `44562a89-2651-4461-8750-58c0bfad4114`，`complete` |
| 校准 | known-bad `fail`，known-correction `pass` |
| Baseline / Candidate | `fail` / `pass` |
| Decision | `promote` 建议；P0A 本身未激活 Candidate |
| 包装检查 | host runtime 仅为 peer、peer/dev 镜像、tarball allowlist 全部通过 |
| 真实 DSH 路径 | pinned DSH `47f9438…765a`；`pnpm pack`、离线 `dsh plugin add`、dump、App Boot、remove、原生 App Boot 全部通过 |
| Composition | baseline 与 Candidate 都为 `01ba47…546b`，非目标组合稳定 |
| Trial | macOS Seatbelt，4 个独立 Trial |
| 模型成本 | proposer input/output 均为 `0`；固定 transport 返回已冻结 Candidate，没有付费模型调用 |

原始本地报告 SHA-256 为 `96ac4e…794e`，proposal evidence 为 `7e1c35…13a4`。本地 Case Pack、evaluator 和原始输出不提交 Git；仓库只保留脱敏结果与哈希，避免把本次 final-test 变成公开开发样本。

## P0A 退出审计

- **稳定拒绝 known-bad**：本地预检与 sealed paired run 两次拒绝同一坏例；公开回归 Case 继续由 CI 覆盖。
- **未见改善**：Candidate 在 Case Pack 出现前已冻结，Baseline 失败、Candidate 首次真实评估通过。
- **无污染**：active Skill 未写入；Case Pack 前后 hash 相同；非目标 composition 相同；正常 DSH Session 仍没有 Evolve Tool/Prompt 常驻增量。
- **可解释报告**：claim、逐项证据、Trial 数、token、模型边界与局限均落盘。
- **收益/成本成立**：零模型 token、约 5.3 秒本地 sealed run，换来可观察的正确包元数据、真实安装启动和可删除性，而不只是“框架能跑”。

因此 P0A 的本地产品退出条件成立，可以进入 P0B Local Continuity 的 test-first 实现。

## 不能据此声称

- Candidate 由已经冻结的 transport 返回；这证明 evaluator 能识别未见修正，不证明真实 provider 会自主提出同等修正。
- Candidate 仍是 Skill 数据，没有执行任意模型生成插件代码。
- 只验证 macOS 单机；没有 workspace 磁盘配额、Linux/Windows executor、长会话 Generation pin 或崩溃恢复。
- 这是单一真实包装 case，不是 false-promotion 率、长期净收益或 Hermes 全面替代证据。
