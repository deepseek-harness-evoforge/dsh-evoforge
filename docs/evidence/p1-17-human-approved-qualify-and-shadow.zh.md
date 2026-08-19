# P1.17 Human-approved Qualify-and-Shadow 验证记录

> 历史证据：Evaluator qualification/Shadow handoff 已在 V4.24 删除，不是当前产品合同。

> 日期：2026-08-17
> 结论：implemented；不能据此声称 evaluator 已可信或优于 Hermes

## 已证明的结果

用户可在读完 exact Evaluator Draft 并填写 note 后，用一个 Commands/Web 动作同时授权 sealed qualification 与“成功后的一次付费 Shadow”。组合入口直接复用 P1.9/P1.10，没有新增 journal、状态机、后台 actor 或模型可见表面。

## 前向测试

- 核心：qualification `not-calibrated` 时 `launchExact` 为 `0`；成功后才启动 Shadow；
- 恢复：qualification 已持久化但 launcher 返回中断时，Draft 保持 `qualified`；重试不会再次运行 qualification；
- Commands：`qualify-shadow <note>` 只返回既有 `start-shadow` receipt，并明确一次人工动作授权的两个效果；
- Web：联合动作可取消；确认前 Remote 调用为 `0`；确认后只调用组合 Remote，不偷偷调用分步接口或 Promotion；
- 真实 DSH：explicit correction → automatic inactive Draft → inspect → one qualify-shadow action → native Job → review；author/proposer 各 `1`，当前 Session、active Generation 和 Git Skill 不变；
- 生成式 Typert 与 packed add/boot/remove/native fallback 通过；显式 Remote allowlist 包含且只包含新方法；
- 真实 Chrome 完成 Inspect → 填 note → 联合确认 → Cancel → 再确认 → durable Done；单独 1 个 Evaluator Draft 显示 `Actionable 1`，再加 1 个 Candidate review 后徽标与顶部均显示 `2`；完整预算/队列布局无错位，控制台错误为 `0`；
- 64 轮真实 Agent 请求逐轮 byte-equivalent；PA-1 为 `125 passed / 1 skipped`；串行全仓门为 `264 passed / 3 skipped`，远端标准并行门见 Draft PR checks。

## 权限、KV Cache 与成本

联合确认明确授权 sealed generated-code execution 和一次 contingent paid Shadow。qualification 失败时 proposer 成本为 `0`；成功后的成本与 P1.10 完全相同，没有额外模型调用。普通 Session 的 Prompt、Tool、Skill、schema 和请求前缀不变，正常 token 增量为 `0`。

该动作不授权 Promotion、merge、release、部署、secret 读取、付费增额或不可逆外部动作；分步入口仍保留。没有真实 provider qualified rate、semantic rejection rate、陌生用户完成时长和生产多日数据，因此状态只能是 `implemented`。

全量检查遇到既有并行 clean 竞态：Telegram cache-composition 在其 `dist/index.mjs` 被并行 package lifecycle 清理时启动。独立 `dsh-telegram build && test` 与串行全仓门均为 `37/37`；P1.17 未修改 Telegram。该记录不把竞态误写成 P1.17 产品能力或顺手修复；标准并行命令继续由远端 Node 22/24 与 macOS CI 验证。
