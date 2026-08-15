# Security Policy

## Supported versions

`dsh-evoforge` 当前处于 pre-alpha，尚无受支持的稳定发布版本。安全修复只针对 `main` 的最新状态；不要将当前代码用于生产自动晋升或执行不受信任的 Candidate。

## Reporting a vulnerability

优先使用本仓库 GitHub 页面的 **Security → Report a vulnerability** 私下报告。请提供：受影响 commit、最小复现、预期边界、实际影响，以及是否涉及秘密、越权写入、case 泄漏、网络、付费或不可逆外部动作。

如果私密报告入口不可用，请创建一个不含利用细节、秘密或个人数据的普通 Issue，请求维护者建立私密沟通渠道。不要在公开 Issue、PR、日志或 fixture 中粘贴 Token、API key、真实 Session 内容或未修复漏洞的完整利用步骤。

## Current security boundary

- P0A.1 不修改 active Skill，也不执行模型生成代码；
- API key 只用于显式 Shadow 请求的 Authorization header，不进入报告或证据；
- 正常 DSH Session 不新增 Tool、Provider、system prompt 或 Skill catalog 项；
- 无法证明 Trial 的 read/write/process/network 隔离时，命令必须返回 `incomplete`；
- merge、release、部署、秘密、付费与不可逆外部动作属于 Protected Action。

这些边界是当前承诺，不代表完整自进化系统已经安全完成。
