# EvoForge v0.1 路线图

> 当前状态：已有能力实现正在收敛为唯一的 DSH 原生插件套件；v0.1 尚未完成、发布或部署。

## 已有实现

- P0A–P1.21：证据驱动 Shadow、Generation、Session pin、review、Retention、预算、反馈学习、canary 和 rollback；
- P2A.1–P2D.1：原生 Skill/Tool 软件交付、Draft PR、exact-head checks、交付 Outcome；
- P3.1/P3.2：Telegram/飞书进化注意力和 GitHub review follow-up；
- LC-1/LC-2：Goal cold resume 与用户级 OS service unit；
- DSH Web review、Runtime Readiness、Workspace Channel Router、已迁移的 Telegram 与飞书 Adapter。

这些条目表示内部实现和自动化证据存在，不等于当前发布形态已经满足 v0.1。

## V0 — 权威集成基线

- 以最新完整能力为基础合并 ADR-0041 原生插件修正；
- 所有用户包使用 DSH Bundle、Cordis plugin、Skill、Tool、Command 或 Client Module；
- 删除 `dsh-evolve`、`dsh-delivery`、`dsh-resident` 产品 bin；
- DSH/Cordis 只作为 peer + dev dependency；
- 建立覆盖全部包的 clean-profile tarball add/dump/boot/remove/readback gate。

退出门：仓库只有一个权威集成分支和一套真实用户安装路径，原生 DSH 数据在卸载后仍可读取。**十一包统一 clean-profile gate 已完成。**

## V1 — Workspace Channel Router

- 直接消费 DSH `WorkspaceRegistry`、Agent、Session、Commands、Approval 和 StorageDomain；
- 静态、可审查、默认拒绝地把外部 tenant/chat/thread/user 绑定到既有 Workspace，并通过原生 API 创建或冷恢复稳定 Agent/Session；
- Router ingress 幂等与各 Adapter outbound delivery 状态分别有界持久化；
- Telegram 成为第一个 Adapter；路由核心不复制 DSH Session、Goal、Schedule 或权限。

退出门：两个 Workspace 的输入、输出、Commands、Approval、Goal 和文件权限在重启前后无串线。**已由 Telegram + 飞书同一真实 Host assembled gate 完成。**

## V2 — 飞书 Adapter

实现状态：Adapter、可靠投递、真实 DSH 单 Workspace 组合、双 Workspace 双渠道同 Host 重启隔离、Telegram/飞书进化注意力、tarball lifecycle 与十一包总装已完成；真实飞书 App 身份请求、标准代理环境 WebSocket 和 setup-only pairing transport 已通过，`/feishu-pair` 可由当前 DSH Workspace/Session 生成静态 route；用户尚未发送配对短语，exact route 消息仍未达到退出门。

- 支持静态授权的私聊或群聊文本、原生 Command、一次性 Approval、最终回答、Goal/Schedule 与进化注意力；
- 凭据、身份与 Workspace route 只能由部署配置决定；
- 事件去重、限流、结果不确定状态和 Cordis dispose 完整；
- Telegram 与飞书共同证明公共渠道接缝，不预建更多平台功能。

退出门：fake API/协议测试、真实 DSH 双 Workspace assembled 测试，以及 exact 飞书 chat/user 下的入站、回复、Command 与 Approval 冒烟。本轮按项目所有者要求不验证 Telegram。

## V3 — Workspace-scoped Evolution

- Candidate、Case Pack、Generation、反馈、预算、review 和 rollback 都有 Workspace 归属；
- 当前 Session 固定 Generation，晋升只影响同 Workspace 的未来 Session；
- 跨 Workspace 引用和状态损坏 fail closed；
- 保留现有 evaluator、Retention、Protected Action、成本和 Cache Contract。

退出门：Workspace A 完成纠正、Candidate、评测、晋升和 future-session 生效时，Workspace B 与 A 的旧 Session 均不变化。

实现状态：上述链路已由固定 DSH 源码的真实 Host 双 Workspace assembled test 完成，并覆盖重启持久化；真实 provider outcome 仍属于 V4。

## V4 — v0.1 验收

- 全包 tarball clean-profile 安装、dump、boot、真实 Agent/Session/Goal、卸载与 readback；**已完成**
- dependency loss、reload、dispose、崩溃、重复事件、429、网络不确定和身份拒绝；
- 完整 composition cache parity；**已完成，见 `pnpm test:cache-contract`**
- DSH Web 真实浏览器成功、刷新和失败路径；
- 多 Workspace、自进化、消息、审批、崩溃恢复和软件交付的 Hermes paired benchmark。

只有证据覆盖的场景可以声明优于 Hermes。merge、registry release 和生产部署仍需用户另行授权。
