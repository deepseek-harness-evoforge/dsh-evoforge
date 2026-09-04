# EvoForge 当前需求基线

更新时间：2026-09-05。本文是维护者实现和评审的当前基线，取代早期把所有交互都写成 Goal 的版本。旧证据仍在
Git 历史和 evidence 目录中，但不再覆盖本文件。

## 1. 产品对象

交付一组可由 DSH 官方机制安装、启停、升级和卸载的 Cordis/Bundle/Client 插件。对象是 DSH 插件组，不是 Codex
插件，不 fork DSH，不修改上游核心，不建设第二 Agent Runtime、Session、Goal、Scheduler、审批中心、数据库或第二/独立
Gateway；唯一的 `dsh-gateway` 是本插件组在 DSH Host 内必须交付的 Bundle。

DSH 是 Agent、Session、Goal、Skill、Tool、Approval、Jobs、Schedule、Workspace、权限、持久化和生命周期的唯一
权威。插件拥有的记录必须存进 DSH 提供的 Storage/Host seam，并明确作用域、dispose、升级和卸载。

## 2. 用户交互

### 必须成立

1. 用户可以像使用普通 DSH 一样发送消息、问题、指令、材料、附件或反馈。
2. EvoForge 不改变 DSH Agent 原本的能力解析与 Tool/Skill 调用方式，也不另造 route planner；它只观察本次实际调用的
   版本、权限和结果。用户不会看到任务类型、工作流、Agent、Skill 或路径选择菜单。
3. DSH 原生 Goal 仅用于需要长期续接、冷恢复或明确目标管理的工作；普通一次性交互不创建 Goal。
4. 自然语言可以声明约束、验收标准和所需权限，但不能扩大 DSH policy 或绕过 Approval。
5. Gateway 渠道消息最终进入一个原生 DSH Session；不要复制一套会话或路由权威。

### 明确不做

- 运行时访问 ClawHub/市场/互联网来下载、导入或安装 Skill；
- 把外部研究资料直接当成运行时能力；
- 用“用户必须先写 Goal”代替自然对话；
- 用普通 retry、模型自评或一次成功宣称学会。

## 3. 自我发现与进化

“自我发现”只表示从 DSH 自身 Interaction 和结果中发现可复用模式。Interaction 包括普通消息、命令、附件、
反馈、Tool/Session 事件、计划触发、渠道事件和可选 Goal 事件。

### 快环

在线记录可归因 signal：实际能力组成、成功/失败、用户纠正、验证结果、观测到的额外工作、token/时延/cache-read、
外部效果和 uncertain。Goal id 可为空。快环不改 active Skill、不调用治理模型、不执行外部副作用。

### 慢环

离线聚类和审查 signal，区分能力缺口、现有 Skill 改进、配置/权限问题和 DSH Core Defect；证据不足时 abstain。
需要生成 Candidate 时，先封存治理输入，再执行：

1. 完整 Skill tree authoring；
2. 独立结构准入和 calibration；
3. 相同 DSH composition/model/permission/budget 的 baseline/candidate paired；
4. 隐藏 holdout、未见样本和 retention；
5. 安全、权限、回归、负迁移、token、时延和 cache 门禁；
6. review、quarantine、promote、reject 或 incomplete。

执行、Candidate 和评测治理三平面隔离；proposer 不能兼任裁判，治理数据不可被 Candidate 读取或修改。

### 版本与恢复

Candidate 按完整目录树内容寻址，绑定来源、父代、DSH revision、权限、边界、评测 hash 和证据。Candidate 默认
inactive/quarantine；当前 Session 固定 Generation，晋升只影响未来 Session。晋升、pause、resume、canary 和
rollback 必须是 Host 权威的原子动作；崩溃恢复从 durable journal 继续，未知外部结果保持 uncertain。

## 4. Gateway 与 Adapter

DSH Host 内只有一个 dsh-gateway。它负责身份规范化、pairing request、Workspace/Session 绑定、ingress/outbound
幂等、限流、恢复和脱敏健康。Feishu/Telegram Adapter 负责平台协议、连接、凭据引用、卡片/附件映射和发送。

陌生私聊首条消息必须在 Agent 前消费并返回一次性配对码；管理员在同一 DSH Web 批准到已有原生 Workspace/Session；
下一条消息才 dispatch。撤销保留原生历史但阻止后续外部效果。Adapter 不得启动自己的 Webhook 服务、Session、
审批或状态库。

飞书最小权限分层为私聊/群聊收发、卡片、图片、文件、知识库、云盘、多维表格；每项独立启用，未获 DSH 官方附件/
Tool 契约支持的类型明确返回不支持。

## 5. Web 控制面

Control Center 使用一个 Session-scoped 的原生 conversation.view；Gateway、Evolution、Delivery、Doctor 通过 child
slot 注入内容。控制面必须：

- 不调用模型、不复制 Session/Storage 权威；
- 在一个页面展示 Host/Bundle、渠道、能力图、Gap、Candidate 谱系/diff、评测、权限、token/时延/cache、晋升和回滚；
- 提供 pause/resume/approve/reject/promote/rollback，并将动作交给对应 Host 权限；
- 对未安装套件显示空态；刷新失败保留 last-good 并标记 stale/error；
- 通过真实浏览器验证新 Session、刷新、401、断连、恢复、失败和卸载。

空 Session 或 DSH onboarding 时官方可能不渲染 conversation.view；不得用固定弹窗或第二网页伪造入口。

## 6. 套件和包边界

默认入口只有 product，它一次安装 Evolution、Doctor、统一 Control Center、Gateway 与第一方渠道 Adapter；delivery、
continuity 是公开可选能力，attention 是可选提醒桥。core、channels、evolution、control、gateway 仅供旧部署迁移或
独立开发，full 仅供维护者验收。物理 Bundle 只有在生命周期、权限、外部依赖或信任边界确实不同才保留；重复的
用户入口应删除。

逻辑套件 id、Bundle id、仓库包名和未来 registry 分发名必须分别记录。当前仓库尚未发布 registry 包，不能让裸
dsh-* 名称解析到未知第三方包。

## 7. 研究与比较

进入新设计前必须固定并记录 DSH、Hermes/Hermes Self-Evolution、OpenClaw、HanaAgent 的 revision/一手资料，并
阅读 GEPA、EvoSkill、SkillHone、OpenSkill、DGM 等论文或开源实现。研究输出区分源码事实、用户痛点、推断和取舍；
研究不会成为运行时外部能力获取。见[研究索引](research/README.zh.md)。

## 8. 验收和发布

每个工作流分别记录 designed、implemented、verified、better、partial、blocked 或 not-measured。better 必须来自
同任务、同模型、同权限、同预算、同 DSH revision 的 Hermes paired benchmark，并记录成功率、人工干预、误调用、
复用、负迁移/遗忘、误晋升、恢复、重复外部效果、token、时延、cache-read、费用（有真实计价时）和精确回滚。

发布前还必须完成 clean-profile add/dump/boot/reload/dispose/remove/readback、真实浏览器、真实 Feishu/Telegram、
真实 Provider、故障注入和单 Host/单页面验证。越权、评测泄漏、当前 Session 漂移、不可卸载或无法精确回滚均阻止
tag 和 registry 发布。

## 9. Git 与文档

只在 main 开发，不用 Git 分支存 Candidate。每个通过测试的最小增量原子提交并推送 origin/main；失败要记录准确
网络错误。核心门通过后创建 annotated SemVer tag，之后每个验证迭代继续以 tag 发布。

README 是用户产品手册；内部规则写 AGENTS.md，当前设计写 architecture/requirements，长期决定写 ADR，真实验收写
evidence，当前阻断写 status。一个变化只更新实际受影响的权威页，不为每个测试复制一套日志。旧设计与本基线
冲突时从工作树删除，Git 历史负责追溯。
