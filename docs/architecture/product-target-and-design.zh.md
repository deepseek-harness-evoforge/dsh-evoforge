# EvoForge 产品目标与设计基线

更新时间：2026-09-05。本文是当前设计的唯一概览，面向贡献者和评审者；用户操作请读根 README，历史增量请读
evidence 索引。本文不把设计、fixture 或单个测试写成产品完成。

## 1. 一句话目标

交付一组符合 DeepSeek Harness 官方 Cordis、Bundle、Client 规范的 out-of-tree 插件，让一个 DSH Host 在真实
工作中拥有 Hermes 的关键用户结果，并在可验证进化、会话连续性、权限边界、可观察性和可回滚性上更可靠。

对象是 DSH 插件组，不是 Codex 插件；不 fork 或修改 DSH，不建立第二个 Agent Runtime、Session、Goal、审批、调度器、
数据库或第二/独立 Gateway；`dsh-gateway` 是本插件组在 DSH Host 内的唯一 Gateway。

“上位替代”是按已声明工作流逐项证明的结果，不是功能清单口号。未通过 paired benchmark 的范围保持
partial/not-measured。

## 2. 用户心智模型

用户面对的是一个 DSH：

1. 在普通会话中聊天、提问、贴材料、上传受支持附件或纠正回答，不进入 EvoForge 专用表单或流程；
2. DSH Agent 仍按原生机制使用当前 profile 的 Skill、Tool、权限和上下文，EvoForge 不增加路径选择器；
3. 需要跨重启继续时，用户才显式使用 DSH 原生 Goal；
4. 需要外部消息时，Gateway 把渠道身份绑定到已有 native Workspace/Session；
5. 需要改进时，用户在同一 Web 控制面看到证据、候选和决定。

自然语言可以表达约束和验收标准，但不能扩大 DSH policy，也不能绕过 Protected Action。

### 2.1 关键术语

| 术语 | 当前含义 |
| --- | --- |
| Interaction | 一次原生 DSH 消息、命令、附件、反馈、计划触发或渠道事件；不等于 Goal |
| Work episode | 从原生 Session/事件日志派生的只读关联视图；不是新的持久实体 |
| Goal | DSH 原生的长任务/续接对象；可选，不是所有请求的入口 |
| Experience signal | 对一次 Interaction 的可核事实：成功、失败、纠正、重试、观测到的额外工作、成本/时延或外部结果 |
| Capability gap | 在检查已有 Skill、Tool、配置和权限后仍无法满足当前请求的可证伪缺口 |
| Candidate | 完整、内容寻址、未激活的 Skill 包及其证据绑定 |
| Generation | DSH 未来 Session 可选择的已发布 Skill 版本；当前 Session 固定 |

## 3. 产品边界

### 3.1 Gateway 与渠道

DSH Host 内的 dsh-gateway 是唯一常驻入口。它负责：

- 规范化外部身份并建立一次性 pairing request；
- 将已批准身份绑定到已有 Workspace/Session；
- 保存 ingress/outbound intent、去重、限流、uncertain 和恢复状态；
- 向同一 DSH Web 控制面提供脱敏健康与操作。

Feishu、Telegram 等 Adapter 只负责平台 SDK、长连接/轮询、凭据引用、平台格式和发送；不拥有 Session、Goal、审批
或第二份路由状态。dsh-resident 只是可选的 OS user service 计划，不是第二个 Gateway。

### 3.2 进化

进化从原生 DSH 事件形成经验信号；它不从市场、ClawHub、互联网或其他 Agent 下载/导入 Skill。外部资料只在
设计期研究使用。Candidate 不能改变正在运行的 Session，也不能读取或修改评测治理面。

### 3.3 软件交付与连续性

dsh-software-delivery 复用 DSH 的 Agent、Shell、Sandbox、Approval 和 Goal；dsh-goal-continuity 只补充受限冷恢复；
两者都不创建任务数据库。GitHub review 是外部不可信输入，必须回到发起它的原生 Session。

### 3.4 Web

Control Center 注册一个原生、Session-scoped 的 conversation.view，再由 Gateway、Evolution、Delivery 等插件注入
child slots。它是只读/受权限动作的 Host 投影，不调用模型、不复制 Session 数据库、不在模块级创建永久 registry。
空 Session 或 DSH onboarding 状态下，DSH 官方行为可能不渲染该 slot；验证必须先打开/创建一个原生 Session，而不是
用弹窗或固定侧栏绕过。

## 4. 研究后的取舍

| 来源 | 吸收 | EvoForge 的具体化/测量 | 明确拒绝 |
| --- | --- | --- | --- |
| Hermes | 常驻 Gateway、跨渠道 Session、渐进式 Skill、异步 review/Curator | Gateway 与 Adapter 共用 DSH Host；paired 逐项记录人工介入、复用、恢复和外部效果 | 把 live Skill 直接当成唯一真相；用活动统计替代效果证据 |
| OpenClaw | 事件驱动编排、隔离候选和人工控制的思路 | Candidate 内容寻址、三平面分权、holdout/retention、abstain/uncertain、原子指针和回滚 | 运行时外部能力获取、第二 Runtime 或新的权限中心 |
| HanaAgent | Page/Widget/统一组件、失败隔离和可视化操作 | 同一 DSH `conversation.view`/Settings seam，统一 loading/empty/stale/error 状态和浏览器门 | 脱离 DSH 生命周期的独立控制面 |
| GEPA/EvoSkill/SkillHone/OpenSkill/DGM | 候选生成、反思、holdout、搜索空间和长期实验的思想 | baseline/candidate 同条件对照，未见样本、负迁移、成本/时延/cache-read 和 paired Hermes 指标 | 模型自评、泄漏评测集、一次成功即发布 |

研究结论必须区分源码事实、用户痛点、推断和产品取舍；固定 revision 与来源见[研究索引](../research/README.zh.md)。

## 5. 用户旅程

~~~text
普通消息/命令/附件/纠正
        │
        ▼
原生 DSH Session + 当前权限 + 已安装能力
        │
        ├── 能完成 → 正常结果 + 可归因 Experience signal
        ├── 不能完成 → Gap investigation（不自动改写）
        └── 长任务 → 用户可选 DSH Goal/原生 Schedule
                              │
                              ▼
                  离线 Candidate → 独立评测 → review/promote/quarantine
                              │
                              ▼
                     只影响未来 Session，失败可精确回滚
~~~

渠道路径是同一流程的外部入口：

~~~text
飞书/Telegram → Adapter → resident Gateway → pairing/route → 原生 Session → Adapter outbound
~~~

首条陌生私聊只产生配对码，不进 Agent；管理员批准后下一条消息才进入绑定 Session。重复事件和不确定发送不会被
盲目重发。

## 6. 公开安装形态

`product` 是唯一默认入口：evolve、doctor、control-center、evolve-web、gateway、feishu 和 telegram 一次安装；
Gateway 空路由启动，平台 Adapter 在明确配置前关闭。`delivery`、`continuity` 是公开可选结果，`attention` 是可卸载
提醒桥。`core`、`channels`、`evolution`、`control`、`gateway` 仅用于迁移/独立开发，`full` 仅用于维护验收。

逻辑套件名、Bundle id 和未来 registry 分发名必须分开记录；当前没有公开 registry 包。

## 7. 可靠性与安全不变量

- 执行、Candidate authoring、评测治理三平面隔离；proposer 不能兼任裁判。
- Candidate 按整包内容寻址，保存来源、父代、权限、边界、DSH revision 和证据。
- baseline/candidate 使用相同 DSH composition、权限、预算和模型条件；holdout/retention 在 authoring 前封存。
- abstain、quarantine、uncertain 是一等结果；缺数据不能当 pass。
- 当前 Session pin 不漂移；promotion/rollback 是原子 Host 决策，只改变未来 Session。
- 代码、凭据、付款、消息发送和外部写入走 Protected Action；卸载不会撤回已发生副作用。
- 所有 listener、timer、watcher、transport 和 Remote 都由 Cordis lifecycle 持有并在 dispose 后消失。
- 凭据只通过 DSH CredentialProvider；不进入仓库、日志、Session 或公共证据。

## 8. 验收与当前状态

发布声明按每个工作流单独给出四态：designed、implemented、verified、better。better 只能来自同任务、同模型、
同权限、同预算、同 DSH revision 的 Hermes paired benchmark，并同时记录成功率、人工介入、误调用、跨任务复用、
负迁移/遗忘、误晋升、恢复、重复外部效果、token/时延/cache-read 和回滚。

最近审计（2026-09-05）确认 canonical DSH 为 d347e703… / 0.1.3-alpha.1，安装通过但上游根构建被 dsh-root
类型入口阻断；EvoForge 可构建支持组合仍为 alpha.5。当前真实渠道、真实 Provider、长期效果和完整 paired
仍未齐备，因此项目保持 pre-alpha，不能宣称整体 Hermes 上位替代。细节见[当前状态](../status.zh.md)和[记分卡](hermes-replacement-scorecard.zh.md)。

## 9. 文档与变更规则

需求/术语改变时先更新 CONTEXT、requirements 与 ADR，再同步架构、状态和 README。历史证据只记录发生过的事实，不
重新定义当前产品。代码只在 main 开发；每个通过测试的最小增量提交并推送 origin/main；运行时版本不使用 Git 分支，
验证通过后才用 annotated SemVer tag。
