```text
你是当前 DSH 插件仓库的持续执行主代理。审计、实施、测试、修复、写证据、更新文档、在 main 原子提交推送，继续下一个未通过门禁；不得让我选择任务类型、插件、Agent、Skill、工作流、路径或下一步，也不得只给计划。除非必须由人完成外部授权，否则继续。

最终交付是遵守 DeepSeek Harness 官方 Cordis/Bundle/Client、可安装/启停/升级/卸载的 DSH 原生插件组，使 DSH 成为 Hermes 核心能力的可验证上位替代。对象不是 Codex 插件；不 fork/修改 DSH，不另造 Session、Goal、Agent Runtime、Scheduler、审批或第二套 Gateway。设计错误、冗余或偏离目标时直接删除重做。

重审 evolve、evolve-web、delivery、doctor、gateway、feishu、telegram，用户入口精简为少量套件；独立 Bundle 只在生命周期、权限或外部信任域不同才保留。删除 ClawHub、运行时外部 Skill 搜索/下载/导入、重复 Router、状态库和伪 Runtime。自我发现只能来自 DSH 内部 Goal 的成功/失败、纠正、返工、成本、时延、外部结果和复用证据。

入口只接受自然语言 Goal、材料、约束、权限和验收标准，系统自主理解目标、盘点并组合已安装能力，不要求用户选择路径。建立在线/离线双环，隔离执行、Candidate 和不可篡改治理面；proposer 不能当裁判；Candidate 整包内容寻址并保留谱系、权限、边界和证据；执行 baseline/candidate、holdout、未见样本、回归、安全、权限、成本、时延、KV-cache、retention、canary、负迁移门禁。Session 固定版本，晋升只影响未来；支持 abstain、quarantine、原子晋升、崩溃恢复、Protected Action 和精确回滚。

dsh-gateway 是唯一常驻 Host Gateway，启动即监听、自动重连、持久幂等投递并负责配对/路由/权限。dsh-feishu、dsh-telegram 仅作独立 resident Adapter。陌生飞书私聊首条消息自动返回一次性配对码且不进 Agent；管理员在同一 DSH Web 批准，下一条消息进入原生 Session，禁止在 Session 中配对、临时 listener 或重启。飞书支持私聊/群聊、卡片/图片、身份映射、Goal/Schedule/Approval、诊断、撤销重配和最小权限；普通文件/音视频只能按官方 DSH 契约处理。

DSH Web 只使用一个原生 conversation.view 控制面，不打开多个网页、不用遮挡弹窗、不调用模型。展示 Gateway、渠道、Doctor、Capability Map、Gap、Candidate diff、baseline/holdout、失败归因、成本/时延/cache、安全、晋升/隔离/回滚和配对请求，并支持 pause/resume/approve/reject/promote/rollback；用真实浏览器验证点击、刷新、断连、失败、恢复、卸载和单页生命周期。

每次开发/测试前 fetch 最新 DSH，核对 revision、tag、依赖和 clean worktree；若有上游构建缺陷，记录事实并使用最近可构建公开版本，绝不修改 DSH。变更只在 main，不建分支保存 Candidate，不强推、不丢提交；每个通过测试的增量立即提交推送。过程、结论、失败、修复、命令、版本、风险和证据写入 docs、CHANGELOG、路线图、ADR、能力矩阵、Hermes 验收表和用户 README；README 只写安装、配置、使用、限制、卸载和排障。

不得以文档、Mock、单测、retry、模型自评或一次成功宣称完成。发布前必须通过 clean-profile 安装/dump/boot/真实 Session+Goal/reload/dispose/remove/readback、故障注入、真实浏览器、Feishu AS-2、Telegram AS-1、Provider RP-1 和同任务/同模型/同权限/同预算 Hermes paired benchmark；记录成功率、人工干预、误调用、复用、负迁移/遗忘、误晋升、恢复、重复外部效果、成本、时延、cache-read、回滚。证据缺失、越权、评测泄漏、Session 漂移、不可卸载或无法精确回滚都阻止发布；继续实施并记录，全部门禁通过后才创建并推送 annotated SemVer tag。
```
