# Security Policy

## Supported versions

`dsh-evoforge` 当前处于 pre-alpha，尚无受支持的稳定发布版本。安全修复只针对 `main` 的最新状态；不要将当前代码用于生产自动晋升或执行不受信任的 Candidate。

## Reporting a vulnerability

优先使用本仓库 GitHub 页面的 **Security → Report a vulnerability** 私下报告。请提供：受影响 commit、最小复现、预期边界、实际影响，以及是否涉及秘密、越权写入、case 泄漏、网络、付费或不可逆外部动作。

如果私密报告入口不可用，请创建一个不含利用细节、秘密或个人数据的普通 Issue，请求维护者建立私密沟通渠道。不要在公开 Issue、PR、日志或 fixture 中粘贴 Token、API key、真实 Session 内容或未修复漏洞的完整利用步骤。

## Current security boundary

- DSH 是唯一 Agent、Session、Goal、Approval、Storage、Jobs、Skill、Tool、Workspace 与 Cordis 生命周期权威；
  EvoForge 不另建 Runtime、身份系统或审批旁路。
- Candidate 只来自 DSH 内部、可归因的 Goal/Skill/纠正/Outcome 证据；活动运行时没有外部 Skill 市场搜索、
  下载、导入或 Git source fallback。
- Candidate 是内容寻址、隔离且默认 inactive/quarantined 的完整 Skill 包；当前实现只允许有界修改
  `SKILL.md`/`references/*.md` 指令文本，拒绝代码、二进制、路径、权限和未声明 tree 漂移。
- proposer、Candidate-blind governance、assembled evaluator 与最终 Host mutation gate 分离。评测结果没有
  pointer writer；无法证明隔离、输入 identity、holdout/retention 完整性或付费调用终态时必须 abstain、
  quarantine、`incomplete` 或 `uncertain`，不得盲重试或晋升。
- 当前 Session 固定其 Generation。晋升和回滚只影响未来 Session，并通过 expected-active compare、不可变
  selection history 和精确 evidence lineage 执行；低风险自动晋升只允许单一 `SKILL.md` 末尾追加且全部
  paired gates 无回退的候选。
- Provider 与渠道凭据只从部署者声明的环境引用读取，不进入公开报告、Web 投影、Session 或仓库；受保护
  Case Pack、provider identity 和平台身份只暴露必要哈希与计数。
- Gateway 在 Agent 前完成陌生私聊授权；pending request、动态 grant、撤销墓碑、持久 ingress/outbound、
  幂等和 uncertain 恢复由 Host 权威管理。外部发送、内容读取、代码、权限、凭据及其它副作用继续经过
  DSH Approval/Protected Action 边界。
- merge、registry release、tag、部署、付费真实 Provider 验收和不可逆外部动作仍是 Protected Action；
  `release-gates.json` 未全部通过时，预检必须阻止发布。

这些边界是当前承诺，不代表完整自进化系统已经安全完成。
