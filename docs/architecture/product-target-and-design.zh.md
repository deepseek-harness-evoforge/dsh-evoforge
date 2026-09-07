# EvoForge 产品目标

更新时间：2026-09-07。本文是产品目标和边界的唯一概览。用户安装说明在根 README，术语在 `CONTEXT.md`，当前状态和
证据分别在 `docs/status.zh.md` 与 `docs/evidence/`。

## 1. 产品是什么

EvoForge 是一组安装到 DeepSeek Harness（DSH）的开源原生插件。DSH 是产品内核，负责 Agent、Session、Goal、Skill、
Tool、Approval、Jobs、Schedule、Workspace、权限、存储和生命周期；EvoForge 在这些能力之上提供 Gateway、渠道接入、
自我进化和统一控制面。

产品的最终结果是：用户安装 EvoForge 后，仍然使用一个 DSH，却得到 Hermes 核心工作流的完整可用体验，并在能力进化、
故障恢复、权限控制、可观察性和回滚方面更可靠。这里的“上位替代”必须按具体工作流和证据判断，不能用插件数量或功能
清单代替验证。

EvoForge 不是 Codex 插件、独立 Agent、第二个运行时或 DSH 分支。它不修改或 fork DSH，也不复制 DSH 的 Session、Goal、
审批、调度和存储系统。

## 2. 用户得到什么

用户可以像使用普通 DSH 一样工作：聊天、提问、发送指令、上传受支持材料、纠正回答，或者从飞书等渠道发消息。用户不
需要先选择任务类型、工作流、Agent、Skill 或路径，也不需要先启动“自我进化流程”。需要长期续接时使用 DSH 原生 Goal；
普通对话不因没有 Goal 而失效。

当用户从外部渠道发消息时，系统把身份绑定到已有的 DSH Workspace/Session。陌生私聊先得到一次性配对码，管理员批准
后，后续消息才进入 DSH Agent。消息重复、连接中断或发送结果未知时，系统保持幂等和可恢复，不重复制造外部效果。

当工作出现重复失败或纠正时，系统在后台从 DSH 自己的交互事实中发现可复用的问题。用户看到的是清楚的状态、证据和决策，
而不是一套新的任务管理界面。

## 3. 插件组成

### dsh-gateway

唯一的常驻 Host Gateway，负责身份规范化、配对、Workspace/Session 绑定、入站和出站意图、幂等、限流、断线恢复、不确定
状态和脱敏健康信息。

### dsh-feishu 与 dsh-telegram

可独立启停和卸载的薄 Adapter，负责平台协议、长连接或轮询、凭据引用、消息格式、卡片、附件和发送。它们把路由、会话、
审批和持久化交给 DSH 与 Gateway。

### dsh-evolve

自我发现和自我进化核心。它记录真实 Interaction 的结果，识别能力缺口，生成隔离 Candidate，并通过独立评测决定是否
让未来 Session 使用新的 Skill 版本。

### dsh-control-center 与 dsh-evolve-web

一个嵌入 DSH Web 的原生控制面。它展示 Gateway、渠道、能力、缺口、Candidate 谱系、评测、权限、成本、时延、cache、晋升、
隔离和回滚，并把管理动作交给 DSH Host 权限。

### dsh-doctor、dsh-software-delivery、dsh-goal-continuity、dsh-resident

分别提供诊断、软件交付、原生 Goal 冷恢复和用户级常驻服务。它们复用 DSH 的原生能力，不建立第二套运行时或权限体系。

## 4. 自我进化目标

自我进化只使用 DSH 内部真实经验：消息、命令、附件、反馈、Tool/Session 事件、渠道事件、计划触发、验证结果、返工、成本、
时延、cache 和外部结果。它不在运行时搜索市场、ClawHub、互联网或下载外部 Skill。

系统采用两段式闭环：在线环快速记录事实和形成调查；离线环聚类问题、生成完整 Skill Candidate，并在隔离环境中进行
baseline/candidate 对照、结构准入、hidden holdout、retention、未见样本、回归、安全、权限、成本和时延评测。

Candidate 必须拥有完整内容地址、来源、父版本、DSH revision、权限边界和评测证据。执行面、Candidate 面和评测治理面
彼此隔离；生成 Candidate 的 proposer 不能担任最终裁判。

证据不足时系统必须 abstain；不安全的 Candidate 进入 quarantine；外部结果未知时保持 uncertain。当前 Session 始终固定
原版本，晋升只影响未来 Session。晋升、canary、暂停、恢复和 rollback 都是 Host 的原子动作，并支持崩溃恢复。

## 5. Web 产品目标

控制面必须在一个原生 DSH 页面内完成。用户能在同一页面看到 Gateway 和渠道健康、已安装插件与 Skill、能力缺口、Candidate
谱系与 diff、评测证据、权限、成本、时延、cache、Protected Action，以及 pause、resume、approve、reject、promote、
quarantine、rollback 的结果。

页面不调用模型，不复制 DSH 状态，不启动第二个网站。刷新、断连、未授权、空 Session、卸载和恢复都必须有明确状态。

## 6. 安装和开源目标

普通用户只需要一个默认 `product` 套件和一条简短安装命令。安装器必须校验完整 manifest 和 SHA，将包保存到持久目录，
调用 DSH 官方 add/remove，并在失败时保留可恢复产物。还要提供可直接交给 DSH Agent 的一行自然语言安装请求。

插件必须能在 clean profile 中完成安装、启动、真实 Session、reload、dispose、卸载和原生数据恢复。所有开发在 `main`
进行；通过验证的增量立即提交并推送。运行时 Candidate 使用内容寻址存储，不使用 Git 分支；首个 annotated SemVer tag
只能在所有发布门通过后创建。

README 是用户手册。架构、需求、ADR、研究、状态和证据各自只有一个权威位置。`examples/` 与 `benchmarks/` 是维护者验收
夹具，不是产品安装内容，也不能被用来夸大产品能力。

## 7. Hermes 上位替代的完成标准

只有同时满足以下条件，才能对某个工作流声明“上位替代”：

1. 用户能在真实 DSH 中安装并完成该工作流；
2. Gateway、渠道、Session、Approval、恢复、卸载和外部效果符合声明；
3. 自我进化的 Candidate 经过独立 baseline、holdout、retention、安全、成本和回滚门禁；
4. 使用同任务、同模型、同权限、同预算和同 DSH revision 与 Hermes 做 paired benchmark；
5. 记录成功率、人工干预、误调用、跨任务复用、负迁移、遗忘、误晋升、恢复、重复外部效果、成本、时延、cache-read 和
   精确回滚；
6. 任何越权、评测泄漏、当前 Session 漂移、不可卸载或无法精确回滚都会阻止发布。

在这些条件完成前，项目只能按工作流标记为 `designed`、`implemented`、`verified`、`better`、`partial`、`blocked` 或
`not-measured`，不能宣称整体 Hermes 上位替代。
