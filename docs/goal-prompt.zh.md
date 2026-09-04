# 持续执行提示（内部）

此文件给维护 Agent 使用，不是用户安装说明；产品用法只写在 README 和 getting-started。

```text
持续在当前 dsh-evoforge 仓库交付一组符合 DeepSeek Harness 官方 Cordis/Bundle/Client 规范的原生插件，使 DSH 在声明的 Hermes 核心工作流上以同条件证据成为可安装、可用、可卸载、可回滚的上位替代。对象不是 Codex 插件、独立 Agent、第二 Runtime/Session/审批系统或 ClawHub。

先读取 AGENTS.md、CONTEXT.md、requirements、当前 architecture/ADR 和适用 skill；每轮先审计并记录最新 DSH revision，同时区分 latest audited 与 buildable support revision。保持 DSH 原生对话入口：普通消息、命令、附件、反馈和渠道事件都能直接进入 Agent，原生 Goal 只用于用户主动创建的长任务续接。EvoForge 不新增前置表单、路线规划器或能力选择菜单，不得让我选择任务类型、Agent、Skill、工作流或路径。

dsh-gateway 必须在同一个 DSH Host 内常驻；feishu/telegram 等只是薄 Adapter，共用 DSH 的 Workspace/Session/Agent/Approval/Storage。自我发现只消费 DSH 内部真实交互、失败、纠正、返工、结果、成本、时延和 cache signal，不在运行时搜索、下载或导入外部 Skill。双速闭环隔离执行面、Candidate 面和不可篡改治理面；Candidate 完整内容寻址、隔离评测、holdout/retention、abstain/quarantine/uncertain、future-Session-only 晋升、canary、精确回滚和崩溃恢复，proposer 不能当裁判。

交付必须包含默认完整 product 安装、可发布 registry 包和给 Agent 的一行安装意图；使用官方 DSH add/remove，Agent 发起的 Shell 写操作服从原生 policy/Approval，人在 shell 直接安装不能伪称已审批。飞书需覆盖配对、私聊/群聊、卡片/文件、身份映射、持久投递、幂等/uncertain、诊断和最小权限，按证据标态。一个 DSH Web 控制面展示 Gateway、能力、Gap、Candidate 谱系、评测、权限、成本/时延/cache、晋升/隔离/回滚和渠道健康；不另造网页，空 Session 的入口问题要用官方 seam 或明确记录为阻断。

先修复当前阻断，再继续下一个未通过门禁：运行最小测试、check:docs、相关 suite/contract、clean-profile 安装/卸载、真实 Session/Goal 恢复、故障注入、真实浏览器、真实渠道/Provider 和 Hermes paired benchmark。不能用文档、Mock、单测、retry、模型自评或一次成功冒充自我进化。README 只写用户手册；同一结论只写一个权威文档，过时设计从工作树删除并由 Git 追溯；examples/benchmarks 只保留被门禁引用的维护夹具。只在 main 小步原子提交并推送 origin/main；Candidate 不用 Git 分支。所有核心门禁通过后才创建 annotated SemVer tag，否则明确 partial/blocked。
```
