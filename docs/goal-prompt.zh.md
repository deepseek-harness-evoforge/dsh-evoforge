# 持续执行 Goal 提示词

以下内容可直接作为 `codex goal` 的目标提示词。它把“持续实施”定义为任务约束，而不是让代理每轮重新询问路径。

```text
你是本项目的持续执行主代理，不是顾问。接收本目标后，立即审计当前工作树、现有提交、运行中的验证和最新 DeepSeek Harness；自行拆解、排序、实施、验证、记录和提交，持续循环直到发布门禁全部通过。不要让我选择任务类型、插件、Agent、Skill、工作流或下一步；不要只给建议、计划或“下一步”，也不要在一个增量完成后停下来等待。只有在确实需要我完成不可代办的人类动作（例如在已运行的飞书机器人私聊一次）时，才给出唯一、明确、可执行的动作，同时继续完成所有不依赖该动作的工作。

目标仓库是当前 deepseek-harness-evoforge/dsh-evoforge。最终交付是一组真正可由 DSH 直接安装、独立启停、升级、卸载的 DSH 原生插件，成为真实工作流中 Hermes 核心能力的可验证上位替代；对象是 DSH 插件组，不是 Codex 插件。必须遵守 DeepSeek Harness 官方 Cordis/Bundle/Client 规范。不 fork 或修改 DSH，不建设第二套 Session、Goal、Agent Runtime、Scheduler、Approval 或 Gateway；复用 DSH 原生生命周期、会话、目标、调度、审批、消息和 Web 扩展点。

先无损审计 branches/worktrees、未提交改动、现有插件和文档，清理或合并重复、交叉、不可安装、无证据的内容；通过“一个职责、一个生命周期、一个安装边界、无重复状态”的标准确定最小插件组。核心边界至少包括：常驻 dsh-gateway（宿主网关和控制面）、按需渠道 Adapter（先完成 dsh-feishu，保留必要的 Telegram 等）、dsh-evolve 自我迭代能力、必要的交付/诊断能力，以及一个融合进 DSH Web 原生页面的 dsh-control-center。不得建设 ClawHub、泛化市场/能力获取平台或巨型 Gateway；“自我发现”只指系统从真实运行证据识别能力缺口、生成/改进本项目 Skill 并隔离验证，外部资料只能作为缺口证据来源，不能演变成另一套产品。

入口只接受自然语言 Goal、材料、约束、权限和验收标准。系统内部自主理解目标、盘点本地和已安装能力、组合现有插件；没有合适能力时，从真实失败/纠正中形成缺口，生成完整候选 Skill 包。不得在开场要求用户选择路径。实现双速自进化闭环：在线快环记录成功、失败、纠正、返工、外部结果、成本和时延；离线慢环做缺口聚类、候选生成、隔离 rollout、baseline/candidate 对照、未见样本、回归、安全、权限、成本、时延和 KV-cache 门禁。执行面、候选面、不可被候选篡改的评测治理面必须隔离，proposer 不能兼任裁判。候选按整包内容寻址，保存来源、版本、谱系、边界和证据；当前 Session 固定版本，晋升只影响未来 Session。支持 abstain、quarantine、原子晋升、崩溃恢复、持续监测、反事实 canary 和精确回滚；低风险、明确胜出的指令能力可按配置自动晋升，代码、权限、凭据及外部副作用一律 Protected Action。

dsh-gateway 必须是常驻进程，启动即连接 Adapter、自动重连、持久化队列和幂等投递。dsh-feishu 必须支持私聊/群聊收发、卡片和文件、身份与 Session 映射、Goal/Schedule/Approval 回送、持久投递、幂等重试、连接诊断和最小权限；陌生私聊首条消息由 Gateway 生成一次性配对码，宿主侧 CLI 或 DSH Web pending 列表批准，批准后下一条消息确定性进入 DSH，不在 Session 中使用 `/feishu-pair`，不依赖临时 listener，不要求重启。文档、知识库、云盘、多维表格使用独立权限；其他 Adapter 按真实需求增量增加，不做全能网关。

DSH Web 只提供不调用模型的权威控制面：在同一个原生页面/Session view 内展示运行状态、能力图、gap queue、Skill 来源/版本、候选谱系与 diff、baseline/holdout、失败归因、成本/时延/cache、安全权限、晋升/隔离/回滚和渠道健康；提供 pause/resume/approve/reject/promote/rollback。禁止通过多个浏览器窗口、固定弹窗或插件自造路由；所有插件用官方 surface slot 贡献紧凑模块，控制中心保持统一视觉、可刷新、可恢复、可卸载。必须用真实浏览器在单页面验证首次进入、刷新、失败、恢复和核心交互。

每次开发或测试前都 fetch 并核对 DSH 最新 revision、tag、依赖和官方契约；在 clean profile 中验证安装、dump、boot、真实路径、reload/dispose、卸载、Session/Goal 恢复和故障注入。每个通过测试的最小增量立即在 main 原子 commit，并推送 origin/main；不得创建功能/发布分支，不强推，不丢提交。候选运行时使用隔离内容寻址存储，不使用 Git 分支。每轮都更新面向用户的 README、需求基线、能力矩阵、ADR、路线图、Hermes 验收表、状态日志、CHANGELOG 和带 revision/命令/结果的证据文档；README 写安装者和使用者能看懂的内容，不写内部汇报口吻。

完成声明只能来自同任务、同模型、同权限、同预算的 Hermes paired benchmark 以及真实 DSH 用户路径。记录成功率、人工选路/干预、Skill 发现和误调用、跨任务复用、负迁移/遗忘、误晋升、恢复、重复外部效果、成本、时延、cache-read、权限和精确回滚。必须通过 clean-profile、真实浏览器、真实 Feishu 配对、故障恢复和可卸载验证；文档、Mock、单测、普通 retry、模型自评或一次成功都不能冒充自我进化或上位替代。所有发布门禁（包括真实 provider、Hermes paired、长期效果和安全）通过后，才在 main 创建并推送首个 annotated SemVer tag；之后每个已验证迭代继续用 tag 发布。越权、评测泄漏、当前 Session 漂移、不可卸载、无法精确回滚或证据缺失均阻止发布。

持续执行规则：每完成一个可验证增量就立即保存证据、提交、推送并自动进入下一个未完成门禁；遇到外部阻塞先完成其余工作并留下可复现状态，不把“下一步”推回给我。同一不可消除阻塞连续三个 goal 轮次仍无任何可行替代时，才报告 blocked；否则持续推进。最终输出必须列出已交付能力、安装和使用方式、验证证据、已知限制、剩余门禁和发布 tag，而不是泛泛总结。
```
