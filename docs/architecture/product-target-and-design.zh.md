# EvoForge 产品目标与设计方案（可读基线）

> **文档性质**：这是给用户、贡献者和后续 Agent 看的产品基线。它回答四个问题：我们要做什么、为什么这样做、已经做到哪里、接下来以什么条件继续。代码实现和逐项测试证据仍以[当前实现状态](../status.zh.md)、[产品架构](evoforge-product.zh.md)和[Hermes 验收记分卡](hermes-replacement-scorecard.zh.md)为准。
>
> **更新时间**：2026-09-05。本文不把“设计完成”写成“产品完成”，也不把本地 fixture 测试写成真实渠道或发布证据。

## 1. 先给结论

我们要交付的不是 Codex 插件，也不是一个新的 Agent 平台，而是**一组可以直接安装到 DeepSeek Harness（DSH）的官方原生插件**。安装后，用户仍然只面对一个 DSH：一个 Host、原生 Agent、Session、Goal、Skill、Tool、Approval、Jobs、Workspace 和存储。

EvoForge 在这个 DSH 上补齐 Hermes 最有价值的用户结果，并在“可证明的自我进化、权限边界、版本稳定、可观察和可回滚”上做得更可靠：

1. 一个常驻的 `dsh-gateway` 接收飞书、Telegram 等渠道消息，先完成身份配对，再把消息送进 DSH 原生 Session；不另起 Gateway 服务或第二套会话。
2. 用户给 Agent 自然语言 Goal、材料、约束、权限和验收标准。Agent 自己盘点并组合**已经安装且可用**的 DSH 能力，不在开场让用户选择任务类型、工作流、Agent、Skill 或路径。
3. 如果真实工作反复暴露能力缺口，系统从 DSH 自己的 Goal、失败、纠正、返工和结果中发现可复用模式，生成隔离 Candidate，独立评测，必要时才让未来 Session 使用新版本。
4. DSH Web 中有一个统一的原生“控制台”，可以看见 Gateway、飞书、能力缺口、Candidate、评测、权限、成本、缓存、晋升和回滚；不为每个插件开一个网页。
5. 用户可以按结果安装少量公开套件；内部 Bundle 仍保持独立启停、升级和卸载。发布前必须经过真实安装、故障、浏览器、渠道、Provider 和 Hermes paired benchmark，不能用文档或单测冒充完成。

一句话定义：**EvoForge 是 DSH 的可安装插件组，让 DSH 成为一个有常驻渠道、可控连续运行、能从自身经验安全进化并且证据可审计的 Hermes 上位替代候选。**“候选”只有在规定的真实验收全部通过后，才可以改称对应工作流的上位替代。

## 2. 两个入口必须分开理解

过去文档把“用户如何安装”和“Agent 如何完成任务”写在一起，容易让人误以为系统启动时要用户选路径。现在固定为两个完全不同的入口：

| 入口 | 用户看到什么 | 系统负责什么 | 明确不做什么 |
| --- | --- | --- | --- |
| **安装入口** | 一条安装指令，或让 Agent 执行一条简短安装请求 | 检查 DSH 版本和 profile，取得并校验 Bundle，幂等安装，启动一个 Host，报告结果 | 不读取秘密、不创建第二运行时、不打开第二网页、不让用户逐个挑插件 |
| **运行时入口** | 一段自然语言 Goal、材料、约束、权限和验收标准 | DSH 原生 Agent 自己理解目标、盘点能力、自动路由、执行、记录结果 | 不显示“请选择任务类型/Agent/Skill/工作流”的开场菜单；不在运行时从互联网或市场下载 Skill |

因此，“入口只接受自然语言 Goal……”是**运行时交互契约**，不是要求用户在安装命令里填写一堆参数，更不是能力获取功能。安装是一次性的产品入口；Goal 是安装完成后的使用入口。

## 3. 总体架构：一个 DSH，三类插件面

```text
用户 / Agent
   │
   ├─ 安装入口：校验、安装套件、启动唯一 DSH Host
   │
   └─ 运行时入口：自然语言 Goal
          │
          ▼
      DSH 原生 Host（唯一运行时与权威）
      ├─ Agent / Session / Goal / Tool / Skill / Approval
      ├─ Workspace / Storage / Jobs / Schedule / 权限
      │
      └─ EvoForge 插件组
          ├─ dsh-gateway：身份、配对、路由、幂等投递、健康
          ├─ Feishu / Telegram Adapter：平台协议、连接、实际发送
          ├─ dsh-evolve：经验信号、Candidate、独立评测、晋升/回滚
          ├─ dsh-software-delivery：隔离交付、验证、Draft PR
          ├─ continuity / resident：受限 Goal 冷恢复、OS 用户服务
          └─ Control Center：同一原生 conversation.view 的可视化投影
```

权威边界只有一条：DSH 负责 Agent 身份、Session 历史、Goal 状态、权限、原生计划、持久化和进程生命周期；插件只保存自己的有界领域证据，并通过 DSH 官方 Cordis/Bundle/Client 接口接入。插件不得建立第二个 Session、Goal、Agent Runtime、审批系统、Scheduler、Gateway server、Memory 数据库或全局控制台。

## 3.1 用一个用户故事看完整链路

假设用户只说一句：“整理本周项目风险，并在仓库里生成一个可审查的 PR。”

1. **安装后不再问路线**：EvoForge 已装进 DSH，只有一个 Host 和一个 Web 页面。用户不需要先回答“这是交付任务还是进化任务”，也不需要指定 Agent 或 Skill。
2. **从飞书开始也一样**：如果用户是陌生私聊，Gateway 先回一次性配对码；管理员在同一页面批准到已有 Workspace/Session；用户的下一条消息才进入原生 DSH Agent。
3. **Agent 自己组合能力**：DSH Agent 检查已安装的交付 Skill、仓库工具和权限，自动完成分析、隔离 worktree、验证和 Draft PR。用户只在真正的 Protected Action（例如推送或外部写入）时批准。
4. **失败会留下可归因证据**：如果它发现现有 Skill 反复缺少“风险清单→证据→PR”这一段，不会偷偷改 live Skill，而是记录 Gap、失败原因、返工和成本。
5. **重复才进入慢环**：多个独立 Goal 都出现同类 Gap 后，后台形成 Opportunity，生成完整 Candidate，在隔离 baseline/holdout/Retention 中比较；用户在“演化”页看 diff 和证据。
6. **新版本只影响未来**：Candidate 胜出并获准后，才生成新的 inactive/active Generation；已经开始的 Session 继续使用旧版本。后续出现回退信号时，sealed canary 和 rollback 恢复精确内容，已经发生的 PR 或消息不会被假装撤销。

这条故事里，Gateway 解决“消息如何安全到达 DSH”，Delivery 解决“Goal 如何交付”，Evolution 解决“经验如何被证明后复用”，Control Center 解决“人如何看见和控制”；它们共同构成一个产品结果，而不是四个互相复制的 Agent。

## 4. 产品形态：四个公开结果，十二个物理 Bundle

仓库当前有十二个可独立装卸的物理 Bundle。它们不是十二个需要用户研究的产品，而是按生命周期、权限和故障边界拆开的实现单元；用户界面只暴露四个默认结果和一个可选附加项：

| 用户安装结果 | 包含的物理 Bundle | 用户得到什么 | 为什么不能简单合成一个包 |
| --- | --- | --- | --- |
| `core` | `dsh-evolve`、`dsh-doctor`、`dsh-control-center`、`dsh-evolve-web` | 自我进化、零模型诊断、统一 Web 控制台 | 进化有 Jobs/Storage/候选状态；诊断是只读能力；控制台是 Client 视图，生命周期不同 |
| `channels` | `dsh-control-center`、`dsh-gateway`、`dsh-feishu`、`dsh-telegram` | 常驻 Gateway、飞书/Telegram、配对、投递和同一网页管理 | Gateway 是平台无关的 Host 深模块；Adapter 持有平台协议和凭据，合并会扩大权限和故障面 |
| `delivery` | `dsh-software-delivery`、`dsh-github-review` | 隔离 worktree、验证、commit/Draft PR、审查返修 | 本地交付与外部 GitHub 输入有不同信任和网络边界 |
| `continuity` | `dsh-goal-continuity`、`dsh-resident` | 受限 Goal 冷恢复和用户级 DSH 常驻 | Goal 恢复属于 DSH Session 生命周期；OS unit 属于 launchd/systemd，不能混成一个状态机 |
| `attention`（可选） | `dsh-evolve-attention` | 把待处理的进化决定提醒到已授权的渠道 | 它只是通知桥，不应让核心进化依赖某个消息平台 |

`evolution`、`control`、`gateway` 是兼容/高级入口，`full` 只供维护者验收。这样做的目的是**减少用户选择**，不是制造一个隐藏的“超级插件”。安装套件仍由 DSH 官方命令逐个安装 Bundle，卸载时每个边界都可验证。

## 5. Gateway 和飞书：常驻但不另造运行时

### 5.1 常驻模型

`dsh-gateway` 是 DSH Host 内的常驻模块，不是额外 HTTP server。它在 Host 启动时恢复自己的 ingress/outbound journal、路由和配对授权；没有任何 route 时也可以启动，但不连接平台、不读凭据、不创建 Agent。`dsh-resident` 只是可选的 OS 用户服务，负责在登录或崩溃后重新拉起同一个 DSH profile；它不是第二个 daemon supervisor。

### 5.2 一条飞书私聊的真实路径

```text
飞书陌生私聊
  → Adapter 收到事件并交给 Gateway
  → Gateway 消费首条消息，生成短期配对请求（首条不进 Agent）
  → DSH Web「控制台 → 渠道」显示脱敏待批准请求
  → 管理员批准到一个已有的 native Workspace/Session
  → 用户发送下一条消息
  → Gateway 幂等写入 ingress journal
  → DSH 原生 Agent 执行并产生回复
  → Adapter 按 delivery intent 发送；不确定结果不自动重复发送
```

凭据只通过 DSH 原生 CredentialProvider 保存，不能写进 Git、profile 明文、日志或 Session。撤销是同一个控制台里的原子动作：保留 Session 和审计 tombstone，阻止后续外部效果，下一条私聊重新返回配对码。普通文件、音视频等没有得到 DSH 原生附件契约支持时，必须明确显示“不支持”，不能伪装成图片或由 Gateway 私自发明通用文件块。

### 5.3 渠道边界

平台 SDK、WebSocket/long-poll、平台重连、卡片格式和实际发送属于 Adapter；身份标准化、配对、Workspace/Session 绑定、幂等、限流、uncertain 状态和脱敏健康属于 Gateway；Agent、Goal、Schedule、Approval、权限和持久化始终属于 DSH。这样才能在不改动 DSH 核心的情况下独立启停、升级和卸载某个渠道。

## 6. 自我发现与自我进化：不是外部能力获取，也不是盲目自改

### 6.1 “自我发现”在本项目中的准确含义

这里的自我发现是：**系统从自己运行 DSH Goal 的可归因证据中发现“反复缺什么”**。它不是从外部搜索、下载、导入或安装 Skill。外部资料、Hermes/OpenClaw/HanaAgent、GEPA/EvoSkill/SkillHone/OpenSkill/DGM 只用于设计期研究和冻结 benchmark，不会成为运行时的隐式能力来源。

运行时固定流程：

1. DSH 原生 Agent 查看当前 Workspace 的 Capability Map（已安装 Skill/Tool 的身份、版本、作用域和验证状态）。
2. 若有适用能力，自动组合并执行；用户不需要选路。
3. 若没有适用能力，或现有能力在权限/配置检查后仍不能满足 Goal，才记录一个可证伪的 Capability Gap。一次失败或一次 retry 不能直接叫 Gap。
4. 多个不同 Goal 反复出现同类 Gap，才形成 Workspace-scoped Skill Opportunity。没有足够独立证据就 `abstain`。
5. Opportunity 经过证据密封后，生成完整的 instruction-only Skill 包 Candidate；Candidate 先处于 inactive/quarantine，不会改变当前 Session。
6. Candidate 在隔离 DSH 组合中与 baseline 做 admission、holdout、Retention、权限、安全、成本、时延和 cache 对照。
7. 独立治理面判定 `promote / review / quarantine / reject`。只有明确胜出的低风险指令能力才允许按配置自动晋升；代码、凭据和外部副作用必须进入 Protected Action。
8. 晋升只影响未来 Session；当前 Session 固定原来的 Generation。后续真实失败可触发 sealed canary 和精确 rollback。

### 6.2 双速闭环

| 速度 | 输入 | 工作 | 输出 | 不能做什么 |
| --- | --- | --- | --- | --- |
| 在线快环 | 成功、失败、纠正、返工、成本、时延、外部结果 | 在一次 Goal 结束时写入可归因 signal，标记 Gap/Outcome/Skill use | 可追踪的经验记录和待观察机会 | 不生成并激活新 Skill，不阻塞当前会话 |
| 离线慢环 | 已密封的跨 Goal 证据 | 缺口聚类、候选生成、隔离 rollout、baseline/candidate/holdout/Retention、回归和治理 | inactive Candidate、证据包、晋升资格或 quarantine | 不读取/修改 evaluator、gold case、policy 或发布权 |

执行面、Candidate 面、评测治理面必须相互隔离；proposer 不能兼任最终裁判。Candidate 按整包内容寻址，保存来源、版本、父代、边界、权限和证据。崩溃恢复、暂停、abstain、quarantine、原子晋升、反事实 canary 和精确回滚都是硬条件，不是“以后再补的优化”。

### 6.3 为什么这比 Hermes 的“直接写 Skill”更可靠

Hermes 的产品体验值得学习：常驻 Gateway、渐进式 Skill、异步 review、Curator 和多渠道。但“写入一个 Skill”本身不等于未来变好。EvoForge 的差异是把**归因、隔离、未见样本、长期保留、版本固定和失败回滚**做成可重放的状态机，而不是让 Agent 或后台 reviewer 直接修改 live Skill：

- 不以模型自评作为发布证据；
- 不以一次成功、普通 retry 或单元测试作为进化证据；
- baseline 与 Candidate 用完整相同的 DSH composition，只有被测整包不同；
- 评测数据在 proposer 之前密封，Candidate 看不到 evaluator 和 holdout；
- 允许保留多个谱系，避免只保留一个“冠军”导致局部最优或遗忘；
- 所有自动动作都有成本、cache、权限和副作用门禁，模糊结果宁可等待人工；
- 回滚恢复的是精确内容和未来 Session 选择，不虚假承诺撤销已经发生的消息、提交或付款。

## 7. Web 可视化：一个原生控制台，而不是多个网页

### 7.1 设计目标

参考 Hermes Dashboard 的状态摘要、HanaAgent 的中央 Page/Widget、DSH TUI 的高信息密度，但不复制它们的独立 Runtime 或后台。产品视觉规则固定为：

- 一个 DSH Web URL、一个原生 `conversation.view`、一个控制台壳；
- 顶部显示 Host/Gateway 总状态和需要处理的数量，细节在页内卡片和表格中展开；
- 常用查看和操作直接在页面内完成，敏感凭据编辑才使用短暂 Dialog；
- 任何刷新、失败、断线和恢复都在同一页可见，失败时清掉过期快照；
- 页面不调用模型、不复制状态库、不改变 Session 的 Tool/Prompt/Skill composition；
- 所有插件使用同一套状态徽章、时间线、证据卡、确认动作和空状态，不再各做一个丑陋的固定弹窗。

### 7.2 统一控制面信息架构

目标中的控制台分区如下（实际只实现 DSH 当前版本支持的表面，未实现项不能伪装成完成）：

| 分区 | 主要内容 | 可执行动作 |
| --- | --- | --- |
| 概览/诊断 | Host、Bundle、DSH revision、阻塞原因、最近错误、能力就绪度 | 重新诊断、查看证据 |
| 渠道 | Gateway、Feishu、Telegram、route、配对、投递 journal、uncertain、权限 | 批准/拒绝配对、撤销、暂停/恢复、刷新 |
| 演化 | Capability Map、Gap queue、Opportunity、Candidate 谱系、diff、baseline/holdout/Retention | approve、reject、quarantine、promote、pause、resume、rollback |
| 交付 | worktree、检查、commit、Draft PR、review follow-up | 查看 diff、批准受保护动作 |
| 连续性 | Session pin、Goal 恢复、Resident plan、最近重启 | 查看/确认 plan、暂停/恢复 |

当前已验证的是同一原生控制台及部分“诊断/渠道/演化”表面；当前用户 profile 曾出现 DSH fallback 文件归属导致的 `EACCES`，以及首次进入时被 DSH 内测声明遮挡的情况。这说明问题是 profile/首屏可达性和浏览器验证门，不是“没有 UI”。正式发布前必须在全新可写 profile、真实失败和刷新恢复路径上重新验证，并保证不打开第二个网页。

## 8. 安装、升级、卸载和发布

### 8.1 当前事实

- 当前仓库尚未发布 registry 包；现在可复现的是由仓库生成的 DSH 官方 tarball。
- DSH 的 `plugin` 命令目前只是把参数转给 pnpm，不能把 `core`/`channels` 这样的套件名当成原生 registry 产品。因此不能杜撰一个尚未拥有命名空间的短 registry 命令。
- 当前安装文档偏长，是因为“生成 tarball、调用官方 DSH 安装、dump、启动、配置”被拆成了多段；产品目标是把这些封装成一个幂等便捷安装入口，同时仍由 DSH 负责真正安装。

### 8.2 目标体验

人类或 Agent 只需表达一次短请求，例如：

> **“把 EvoForge 的 core 和 channels 安装到当前 DSH profile，自动检查版本和权限，复用唯一 Host/Web，完成渠道与控制台健康检查，并报告未通过的门；不要创建第二运行时或网页。”**

安装器随后自动完成：检测 DSH 最新兼容版本 → 下载/生成并校验 Bundle → 备份可恢复的 profile 变更 → 幂等 `plugin add` → `dump` 检查 Bundle 状态 → 启动一个 `--no-open` Host → 输出同一网页中的控制台入口和证据摘要。任何需要用户亲自完成的第三方后台操作（例如飞书事件权限）才明确提示，不能把选择任务路径推给用户。

registry 包、短安装命令和签名/校验策略只有在公共命名空间、所有权、发布 CI、tag→tag 升级、干净 profile 安装/卸载全部通过后才落地；在此之前，文档必须明确“未发布”，不能让 `dsh-*` 解析到无关第三方包。

### 8.3 Git 纪律

- 仓库开发永远在 `main`，不创建 feature/release 分支，不强推、不丢提交；每个通过测试的最小增量原子 commit，并尽可能推送 `origin/main`。
- Candidate/Generation 使用隔离的内容寻址存储，不使用 Git 分支保存运行时版本。
- 核心功能经过 clean-profile 安装、dump、boot、真实 Goal/Session、reload/dispose、卸载、浏览器、渠道、Provider 和 paired benchmark 后，才创建首个 annotated SemVer tag；以后每个通过验证的迭代继续用 tag。

## 9. 当前进度：已经做了什么，还不能宣称什么

| 领域 | 当前真实结论 | 状态 |
| --- | --- | --- |
| DSH 基线 | 已重新审计 canonical 最新 `origin/master`（`d347e703…`、`0.1.3-alpha.1`）；官方安装通过，但上游根构建受缺失类型入口阻断；EvoForge 以审计过的可构建 alpha.5 组合做回归 | **部分完成/上游阻断** |
| 插件契约与套件 | 十二个官方 Bundle、四个公开结果套件、独立启停/卸载和 clean-profile tarball 路径已有代码与合同测试 | **本地已验证** |
| Gateway | DSH Host 内常驻、路由/配对/幂等 journal/uncertain/健康投影及启停竞态防护已实现 | **本地已验证；真实长期运行待验** |
| 飞书/Telegram | 官方协议 Adapter、DSH 原生凭据、陌生私聊配对和本地 assembled 回归已有；真实 AS-2/AS-1 的完整消息、Approval、Schedule、故障、卸载和长期重连尚未形成发布证据 | **部分完成** |
| 自我进化 | 内部 Gap→Opportunity→整包 Candidate→独立 Shadow/Retention→future-Session 晋升/Canary/rollback 的架构和大量本地合同已实现；两套独立真实 Provider、长期迁移/遗忘/负迁移和同条件 paired 仍待完成 | **部分完成，不能称上位** |
| Web 控制面 | 已有一个原生 DSH `控制台`，历史单页浏览器证据证明诊断/渠道/演化可达；当前 profile 权限和 DSH 首屏遮挡问题仍需修复/复验 | **部分完成** |
| Hermes 对照 | 当前有窄的确定性 EV-1/SD-1/LC-1/AS-1 slice；它们只支持对应控制面结论，不支持整体 Hermes 上位替代 | **证据不足以发布** |
| 一键安装/registry | 尚未有可公开安装的 registry 包；也没有可以诚实宣称“短命令即完成”的正式发布入口 | **未完成** |
| 发布 | 无首个 annotated SemVer tag；真实渠道、Provider、长期效果、陌生安装和所有硬门未全部通过 | **阻断** |

当前仓库的交付事实也必须透明：`main` 比 `origin/main` 多两个已提交的 benchmark/docs commit；工作树另有四个未提交的 benchmark runner/package.json 修复，上一轮完整检查在中断后尚未重新确认，网络推送也曾被环境阻断。因此“代码已经写了”不等于“已推送、已发布或已通过所有门”。

可复核入口： [最新全量本地检查](../evidence/v5-221-latest-dsh-full-check-2026-09-04.zh.md)、[当前 Hermes slice](../evidence/v5-224-current-hermes-benchmark-suite-2026-09-04.zh.md)、[本地配对回归](../evidence/v5-223-local-pairing-assembled-regression-2026-09-04.zh.md)、[单页控制台历史浏览器证据](../evidence/v5-196-single-page-control-center-live-revalidation-2026-09-04.zh.md)、[浏览器策略阻断记录](../evidence/v5-222-browser-policy-repeat-2026-09-04.zh.md)和[插件边界审计](../audits/2026-09-03-package-boundary-audit.zh.md)。

## 10. 接下来按什么顺序做

这不是让用户选择的路线菜单，而是项目自己的连续执行队列；每一阶段有退出条件，未达标就修复，不用新增插件数量掩盖问题。

### 阶段 A：先把“能装、能启动、能看见”做成产品

- 更新并重新审计 DSH 最新 revision；把上游构建阻断与支持组合写入证据。
- 解决 profile 可写性/权限预检，安装器做到幂等、可恢复、无秘密泄漏、只启动一个 Host。
- 把本地 tarball 入口收敛成一个短的人类/Agent 安装动作；registry 只在命名空间和发布 CI 通过后启用。
- 在 DSH Web 同一控制台完成概览、渠道、演化的空状态、错误、刷新和恢复视觉统一。

**退出条件**：全新 profile 安装/升级/卸载成功；一个 Host、一个网页；用户能在页面找到 Gateway 和自我进化状态；失败原因可见且可恢复。

### 阶段 B：把 Gateway/飞书做成真实可用的常驻工作流

- 用真实飞书 App 完成陌生私聊 code→管理员批准→下一条消息进原生 Session。
- 完成真实回复、Command、Approval、官方 Schedule、重启后新消息、撤销重配、断连/限流/uncertain、卸载和 Session readback。
- Telegram 执行同等外部验收；所有外部效果只允许通过受保护动作。

**退出条件**：AS-1/AS-2 合同在同一模型、权限和预算下可重复通过；无重复发送、无跨 Workspace 串线、无第二网页/Runtime。

### 阶段 C：把“自我进化”从本地工程证据推进到真实效果

- 固定两套独立真实 Provider，按同一任务、模型、权限、预算和 DSH revision 运行。
- 采集 skill discovery recall/误调用、首次成功、跨任务复用、负迁移、遗忘、误晋升、成本、时延、cache-read、恢复和回滚。
- 运行未见样本、长期 Retention、失败 Outcome canary 和反事实对照；任何数据缺失都标为 `not-measured`，不填平均数。

**退出条件**：Candidate 不可改评测治理面；当前 Session 不漂移；只有未来 Session 使用晋升版本；失败可精确回滚；真实结果在预声明主指标上不劣且至少一个 Hermes paired 工作流胜出。

### 阶段 D：公开发布并持续迭代

- 发布拥有明确命名空间的 registry Bundle 和最短安装入口，提供校验、升级、卸载和回滚说明。
- 从 clean profile、真实浏览器、真实渠道、Provider、Hermes paired、长期 soak 重建发布报告。
- 在 `main` 创建首个 annotated SemVer tag；之后每个验证迭代只追加 tag，不用分支保存 Candidate。

**退出条件**：`DS-1/SD-1/LC-1/EV-1/UI-1/KV-1/PA-1/RM-1` 全部达到 `verified`，至少一个真实助理渠道达到 `better`；否则继续标记为 `pre-alpha/partial`。

## 11. 绝对不能用来“宣布完成”的东西

以下任何一项都不能单独证明自我进化或 Hermes 上位替代：一份设计文档、Mock、普通 retry、单元测试、模型自评、一次本地成功、一次浏览器截图、一个假消息、一个固定 prompt、一个新插件名称、一个通过的窄 slice，或“代码看起来已经很完整”。

真正的完成声明必须来自同任务、同模型、同权限、同预算、同 DSH revision 的 paired benchmark，并且同时记录成功率、人工介入、Skill 发现/误调用、跨任务复用、负迁移/遗忘、误晋升、恢复、重复外部效果、成本、时延、cache-read 和精确回滚。越权、评测泄漏、当前 Session 漂移、不可卸载或无法精确回滚，任何一个出现都阻止发布。

## 12. 文档地图

- [用户 README](../../README.md)：只写用户怎样安装、使用和卸载，不塞内部实现细节。
- [能力套件说明](../capability-suites.zh.md)：解释四个公开安装结果与十二个物理 Bundle 的边界。
- [产品架构](evoforge-product.zh.md)：完整插件与 DSH 原生接缝设计。
- [自我进化架构](evolution-design.zh.md)：双速循环、三平面、Candidate、Retention、晋升和回滚的实现契约。
- [Hermes 上位验收记分卡](hermes-replacement-scorecard.zh.md)：按工作流声明 `designed/implemented/verified/better` 的硬门。
- [当前状态](../status.zh.md)：按增量记录已做工作、命令、证据和阻断。
- [研究资料](../research/README.zh.md)：Hermes、OpenClaw、HanaAgent 与前沿自进化项目的来源和 revision。
