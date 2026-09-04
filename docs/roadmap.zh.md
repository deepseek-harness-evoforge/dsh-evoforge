# EvoForge 路线图

这是维护者的连续执行队列，不是让用户选择的菜单。每项工作都以真实证据为退出条件；未通过就修复或明确阻断，
不通过增加插件数量掩盖。

## 当前优先级

### P0：能安装、能看见、能卸载

- 每次开发前审计最新 DSH；区分 latest audited 与 buildable support revision。
- 将本地 tarball 安装收敛为默认 `product` 幂等入口，校验 exact manifest，并把 DSH 持续依赖的包保存在
  内容寻址的持久数据目录；失败保留可恢复产物且不打印 effective config。
- 一个 Host、一个认证 Web URL、一个 Session-scoped Control Center；空态、401、刷新、断线和恢复可见。
- 完成 add → dump → boot → reload/dispose → remove → native Session/Goal readback。
 `report_capability_gap` 的工具层硬依赖已拆除：无 Goal Interaction 会持久化 signal 并明确 `abstain`，且不触发旧慢环。
 下一步把可重放 Interaction episode 接入 opportunity、Candidate 资格和评测门，再替换旧的 Goal-only 计数。

退出：clean profile 可重复安装/升级/卸载，且不会残留 listener、网页、状态或秘密。

### P1：真实 Gateway 与渠道

- dsh-gateway 常驻 Host；Feishu/Telegram Adapter 独立启停。
- 私聊 pairing：首条返回 code 且不进 Agent，管理员在同一 Channels 页面批准，下一条进入已有 Session。
- 完成持久 ingress/outbound、幂等、uncertain、重启新消息、撤销重配、Approval/Schedule/group 和最小权限。
- 真实浏览器验证单页交互，真实 Feishu AS-2、Telegram AS-1 在授权环境中重复运行。

退出：同一模型/权限/预算下真实消息不串线、不重复、不丢失；失败可恢复，卸载后 DSH 原生数据仍可读。

### P2：可证明的自我进化

- 将所有原生 Interaction 纳入快环；Goal 仅为可选关联，不是触发前提。
- 统一 Gap/investigation、existing-Skill improvement 与 instruction-only Candidate 的证据模型。
- 完成执行、Candidate、治理三平面隔离，holdout/retention 预封存，proposer 与裁判分离。
- 记录真实 token、时延、cache-read、权限、失败归因、负迁移、遗忘、误晋升和回滚。
- 在两套独立真实 Provider 上运行同条件 Hermes paired benchmark。

退出：Candidate 只影响未来 Session；任何缺证据、泄漏、漂移或重复副作用都 fail closed；至少一个声明工作流达到
better，其余声明范围达到 verified。

### P3：开源发行

- 解决公共 registry 命名空间、provenance、签名/校验和最短安装入口。
- 生成面向用户的安装器/Agent 一行入口；安装、升级、卸载使用官方 DSH CLI。Agent 发起的 Shell 写操作服从
  DSH Tool policy/Approval；人在 shell 直接执行不能伪称通过 Agent Approval。
- 在 main 完成全部 release gates 后创建首个 annotated SemVer tag；以后每个已验证迭代只追加 tag。
- 发布可读的用户手册、贡献指南、研究索引、证据索引和变更日志。

退出：新用户可从干净 profile 安装、使用、升级、卸载；发布声明只覆盖有 paired/真实证据的范围。

## 文档维护

同一结论只写在一个权威位置：用户行为写 README/安装指南，产品合同写 requirements/architecture，长期决定写
ADR，真实验收写 evidence，当前阻断写 status。不要为每次单测追加 V 编号或把同一段复制到所有文件；已有 V4/V5
证据保持不可变但不再定义当前设计，过时设计只留 Git 历史。
