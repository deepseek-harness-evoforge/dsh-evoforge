# CLI 编码智能体用户痛点：一手证据与 oh-my-dsh 含义

> 调研快照：2026-08-14 17:32 UTC。本文是需求证据笔记，不是架构规格。

## 结论

现有证据不支持“多数 DSH 用户首先需要跨会话自治内核”这一判断。DSH 发布初期互动最高的话题是：能否安装并启动、有没有 CLI、能否远程访问、能否沿用既有记忆和插件，以及基础 GUI/目录选择体验。长期自治有价值，但目前是项目目标用户的一项待验证假设，不是已证明的社区首要需求。

更广泛的开发者调查把“可信正确”放在自治时长之前：开发者最大的 AI 工具挫折是结果几乎正确却不完全正确，其次是调试 AI 生成代码耗时。跨 Claude Code、Codex、Hermes 的一手 issue 数据又反复出现工作或会话丢失、无人值守任务被审批或恢复流程卡死、插件生命周期泄漏、上下文/缓存/资源成本失控。两组证据共同支持“先把现有 Goal 变成可验证、可隔离、可恢复的软件交付闭环”，不支持另造 Mission、通用工作流内核或自进化平台。

这些问题是需求信号，不是 oh-my-dsh 的缺陷修复清单。DSH 自身违反既有契约的安装、会话、资源或界面问题属于上游；只有能够通过受支持插件接口提供、并且在 DSH 完全正确时仍然有价值的新增能力，才进入 oh-my-dsh 路线图。

因此，oh-my-dsh 当前最合理的价值主张是：

> 通过可选插件让原生 DSH 获得新的软件交付能力：接入既有工作方式，并让一个 Goal 在缓存稳定和权限边界不变的前提下产出可验证、可审查、可回滚的交付物。

## 方法与限制

- 只使用所有者控制的一手来源：官方仓库文档、官方 GitHub Issues/Discussions。未使用博客、聚合站或二手评测。
- DSH 本地分析基于 `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`。GitHub 仓库创建于 2026-08-13，调研时关闭 Issues、开启 Discussions，公开 Issue 数为 0。
- DSH Discussion 互动数来自调研时 GitHub Discussion comment count。开帖正文不计作评论。
- 其他项目的计数采用 GitHub 查询 `is:issue label:"..."`，包含 open 和 closed issue、排除 PR。标签会重叠，标签维护规则也不同，因此只能说明同一仓库内某类问题反复被记录，不能跨仓库比较市场份额。
- 调研时仓库 issue 总量约为 Claude Code 84,000、Codex 22,830、Hermes 21,496。Issue 数不是用户数；单个用户可能提交多个 issue，标签也可能漏标。
- 代表性 issue 从相应标签下高评论结果中选取，用于展示问题机制，不是随机样本。
- 没有公开用户调查、活跃安装量或行为遥测，因此本文不会使用“多数用户”“市场普遍需要”等表述。

## 广泛开发者需求信号

Stack Overflow 2025 Developer Survey 不是 DSH 专项调查，但它比 issue 数更适合回答开发者使用 AI 工具时的共同诉求：

- 31,476 名回答者中，66% 把“AI 方案几乎正确但不完全正确”列为挫折，45% 认为调试 AI 生成代码更耗时。
- 33,244 名回答者中，46% 不信任 AI 输出准确性，只有 33% 表示信任。
- 在 AI Agent 相关问题中，87% 担心准确性，81% 担心安全与数据隐私。
- 开发者对高责任任务保持明显克制：76% 不计划让 AI 负责部署和监控，69% 不计划让 AI 负责项目规划。
- AI Agent 仍未成为主流：52% 不使用 Agent 或只使用更简单的 AI 工具，38% 没有采用计划。

来源：[Stack Overflow 2025 Developer Survey — AI](https://survey.stackoverflow.co/2025/ai)。这些数字说明首要产品机会是减少“差不多对”和返工、让结果可验证且动作可控制；它们不证明用户需要复杂的自治编排。

## DSH 社区直接信号

以下按评论数排序；这是一个刚发布项目的早期信号，不应被解释为稳定的长期排序。

| Discussion | 评论 | 用户在尝试完成的事情 |
|---|---:|---|
| [#76 允许远程 host/access](https://github.com/deepseek-ai/deepseek-harness/discussions/76) | 28 | 从其他设备访问，而不是只能绑定本机；同时暴露了远程代码执行的安全边界 |
| [#67 CLI](https://github.com/deepseek-ai/deepseek-harness/discussions/67) | 25 | 在终端内使用和自动化，而不是只依赖 Web UI |
| [#14 迁移/复用既有 memory](https://github.com/deepseek-ai/deepseek-harness/discussions/14) | 24 | 不丢弃 Claude Code、Codex 等已有知识资产 |
| [#49 Arch Linux 安装失败](https://github.com/deepseek-ai/deepseek-harness/discussions/49) | 16 | 在非预期发行版上完成安装和原生依赖加载 |
| [#30 Windows directory picker 失败](https://github.com/deepseek-ai/deepseek-harness/discussions/30) | 14 | 能打开现有项目，这是进入产品价值之前的阻塞点 |
| [#34 模型与 harness 的实际效果](https://github.com/deepseek-ai/deepseek-harness/discussions/34) | 14 | 确认换框架后效果确实提高，而不仅是架构新颖 |
| [#91 原生 GUI](https://github.com/deepseek-ai/deepseek-harness/discussions/91) | 13 | 获得稳定、熟悉的桌面使用入口 |
| [#68 迁移既有插件](https://github.com/deepseek-ai/deepseek-harness/discussions/68) | 9 | 复用其他生态能力，避免重写 |
| [#62 Skill 按需加载、Sandbox、缓存](https://github.com/deepseek-ai/deepseek-harness/discussions/62) | 4 | 降低模型表面杂乱，改善隔离和缓存命中 |
| [#74 关闭终端后 Web 一同退出](https://github.com/deepseek-ai/deepseek-harness/discussions/74) | 2 | 让服务脱离临时终端常驻；讨论中的现成回答是使用 PM2 |
| [#109 Ralph 有界失败接续](https://github.com/deepseek-ai/deepseek-harness/discussions/109) | 0 | 在已有轮次预算内从普通 child failure 接续，不引入持久调度器 |

两项重要反证：

1. [#14](https://github.com/deepseek-ai/deepseek-harness/discussions/14) 的回复已经列出 `dsh-memory`、`dsh-mnemon`、`dsh-plugin-meta-memory` 以及 Claude/Codex/OpenCode/Pi bridge。痛点可能是发现、选择、验证和迁移体验，而不是缺少又一个 memory 实现。
2. [#68](https://github.com/deepseek-ai/deepseek-harness/discussions/68) 已出现 `pi2dsh`，并报告真实 Cordis 组合、工具/命令和契约测试覆盖。oh-my-dsh 不应在没有差异证据时复制通用插件转换器。

## 跨项目的重复问题

这些计数只作“重复出现”证据，不作跨项目排名。

| 官方仓库 | 标签快照 | 代表性失败机制 |
|---|---|---|
| `anthropics/claude-code` | `area:permissions` 1,969；`area:sandbox` 526；`area:cost` 2,453；`area:plugins` 1,429；`data-loss` 404；`area:routines` 319 | [会话 transcript 被静默清理](https://github.com/anthropics/claude-code/issues/59248)；[定时任务的 MCP 调用等待一个不存在的审批 UI](https://github.com/anthropics/claude-code/issues/61015)；[历史变化使 KV Cache 失效并产生巨大 cache write](https://github.com/anthropics/claude-code/issues/40524)；[Telegram 插件错误加载到所有会话并竞争消息](https://github.com/anthropics/claude-code/issues/38098) |
| `openai/codex` | `automations` 229；`performance` 1,245；`mcp` 1,018；`code-review` 321；`memory` 83；`plugins` 40 | [Automation 已建 run、却没有可恢复 rollout](https://github.com/openai/codex/issues/16994)；[旧会话的 MCP 工具消失，新会话正常](https://github.com/openai/codex/issues/15508)；[插件子进程未回收，积累僵尸进程和内存](https://github.com/openai/codex/issues/12491)；[定时任务误解释时区](https://github.com/openai/codex/issues/26633) |
| `NousResearch/hermes-agent` | `area/sessions` 1,398；`sweeper:risk-session-state` 1,412；`comp/plugins` 1,828；`comp/cron` 1,178；`sweeper:risk-message-delivery` 954；`area/memory` 498；`area/compression` 243 | [跨进程访问同一 session 需要序列化](https://github.com/NousResearch/hermes-agent/issues/67442)；[压缩后身份接力失败使后续 turn 持续失败](https://github.com/NousResearch/hermes-agent/issues/82001)；[桌面重启杀死消息 gateway 却未重启](https://github.com/NousResearch/hermes-agent/issues/83683)；[插件扩展计划明确要求兼容、缓存稳定、observer-first](https://github.com/NousResearch/hermes-agent/issues/64182) |

## 按证据强度排序的用户诉求

### 1. 结果必须可信，失败不能把返工留给用户

大样本调查中最稳定的信号是准确性、返工、安全和隐私，而不是更长的自主运行时间。用户真正购买的是完成结果，不是 Agent 运行轮数。

含义：软件交付 Pack 应优先隔离变更、遵循仓库规范、执行仓库自己的测试/构建检查、呈现可审查 diff，并在 Goal 完成前给出小而确定的 Completion Check。不要先建五层证据本体，也不要让执行 Agent 的自我声明成为唯一完成依据。

### 2. 先让我装好、启动、进入项目并持续可访问

这是当前 DSH 最强的直接信号：CLI、远程访问、Linux 原生模块、Windows 目录选择、GUI、终端关闭后的进程寿命都排在前列。它们是价值实现前的门槛。

含义：开源套件需要优先提供诊断、兼容性说明、常驻服务配方和清晰失败信息。远程监听和原生 GUI 涉及宿主安全或核心产品形态，应向 DSH 上游反馈，不能伪装成普通 Agent 插件。

### 3. 复用我已有的记忆、Skill、配置和插件

DSH 的 memory 与插件迁移讨论互动高，且社区已经快速交付多个 bridge、memory 和 `pi2dsh`。这说明“别让我从零开始”是真需求，同时也说明供给已经出现。

含义：优先做可发现目录、兼容性/健康检查、组合示例和迁移验证；不要默认再造 memory、Pi adapter 或统一迁移框架。

### 4. 不丢工作，失败后给出明确且安全的继续路径

DSH 自身只有较弱的常驻/失败接续讨论信号，但三个成熟项目都存在 session 丢失、resume 失败、压缩后断链和进程重启后服务消失的问题。这是跨产品的重复运营痛点。

含义：扩展现有 DSH Goal 与 Session Persistence，比新增 Mission 概念更合适。用户仍只创建 Goal；可选 Supervisor 负责进程重启后发现、恢复或明确标记不可恢复。第一版只承诺单 Goal、单机、有限恢复次数。

### 5. 自动执行要安全，但不能被无处确认的审批卡死

权限与 Sandbox 在 Claude Code 中被大量标记；定时 Routine 的典型失败正是 MCP 需要审批，却没有在线用户。痛点不是“需要更复杂的权限语言”，而是交互执行与无人值守执行的授权语义不一致。

含义：复用 DSH 原生 Approval 和 Permission Preset；为自动编辑、测试、提交、Draft PR 提供一个小而明确的策略示例。Merge、发布、生产部署、秘密读取、付费和不可逆外部动作继续失败关闭。不要先造 Policy Grant 平台。

### 6. 插件应按声明作用域加载、稳定存在并完整卸载

三个仓库都有大量插件/MCP 相关记录。典型故障不是缺少扩展点，而是插件加载到错误会话、会话运行中工具消失、子进程不回收以及消息消费者互相竞争。

含义：oh-my-dsh 的插件规范必须要求显式作用域、可逆 dispose、子进程所有权、稳定注册顺序和重启测试。首版无需再抽象一套插件管理内核。

### 7. 成本与 KV Cache 必须可预测

DSH 直接讨论量尚小，但 Claude Code 的 cost 标签和缓存失效 issue 表明这个问题会直接转化为费用与速度退化。Hermes 的插件接口讨论也把 prompt caching 作为不可破坏约束。

含义：这是全套件不变量，而不是一个产品插件。CI 对完整 composition 的系统提示词、工具名/Schema 和顺序做 snapshot；动态状态只追加，不改写缓存前缀；版本变化只影响新 session。纯后台插件不需要额外制造模型可见工具。

### 8. 长期自治与自进化目前是战略假设，不是已证实高频诉求

DSH 关于有界 failure successor 的 Discussion 尚无评论，常驻进程问题只有少量互动。没有证据支持 Mission、任务 DAG、Evidence 图、通用 Effect Broker 或自动晋升是当前用户的首要购买理由。

含义：这份调研不能把自进化包装成已验证的大众刚需；它仍可以由产品所有者选择为差异化战略，但必须先以 shadow loop 验证候选质量、误晋升率、回滚和缓存影响，再开放自动晋升。

## 对 oh-my-dsh 的直接取舍

### 现在保留或实现

- **Software Delivery Pack**：先解决“几乎正确”和返工问题；隔离 worktree、编辑、测试、提交、可审查 diff 与 Draft PR，并复用仓库自身的规范和验证命令。
- **Goal，不是 Mission**：保留原生 Goal 用户心智；单机常驻与崩溃恢复作为第二阶段可选增强，不公开新的长期目标领域模型。
- **轻量 Doctor/Readiness**：检查运行时、原生依赖、目录访问、端口/host、安全配置、后台服务状态和已装插件；尽可能不增加模型工具面。
- **Goal Completion Check**：先用测试退出码、工作区状态、commit 与 Draft PR URL 的小结果结构；不先建 Claim/Evidence/Gate/Evaluator/Verdict 五层体系。
- **Evolution Shadow Loop**：把软件交付结果作为第一组 Learning Signal，生成隔离候选并做 active/candidate 配对试验；P0 只报告决策，不自动改变当前能力。
- **Cache Contract**：composition 级 snapshot、稳定前缀和新 session 生效规则。
- **插件质量工具**：生命周期、scope、崩溃恢复、缓存表面和卸载后资源泄漏的契约测试。

### 直接复用

- DSH 的 Goal、Session Persistence、Approval、Permission Preset、Jobs、Schedule、Workflow/Ralph、FS、Shell、Skills 和 Cordis lifecycle。
- 社区现有 memory、Claude/Codex/OpenCode/Pi bridge 与 `pi2dsh`；先维护经验证的兼容目录和组合示例。
- OS 服务管理器负责进程拉起；插件只负责识别和恢复 DSH 工作状态。

### 暂不做或明确不做

- Mission、Work Item DAG、Session Epoch 等新的公共用户概念。
- 通用事件溯源平台、Projection/Outbox、Effect Broker、分布式 Lease 或多 worker 调度器。
- 又一个通用 memory 系统、Pi 插件转换器或平行插件管理器。
- 平行 Policy Grant/审批平台；先复用 DSH 原生权限接缝。
- 未经 shadow 数据验证的自动晋升，以及可执行 Plugin 的自动激活。
- 同时交付个人助理、内容、消息、日程等所有 Capability Pack。
- 用插件绕过 DSH 对远程 RCE、秘密读取或生产动作的安全边界。

## 首轮验证指标

在讨论更多架构前，用 5 个可观察结果验证产品是否解决真实问题：

1. 新用户从 clone 到第一个可运行 Goal 的时间与失败率。
2. 进程强杀/机器重启后的 Goal 可恢复率，以及无法恢复时是否给出明确原因。
3. 在真实仓库中从目标到测试、commit、Draft PR 的完成率与人工介入次数。
4. 同一 Goal 内模型可见工具表面的稳定率和 KV Cache 命中率。
5. 插件卸载或 Goal 结束后遗留的进程、端口、worktree 和凭据句柄数量。

只有这些数据证明一个 Goal 不够、或出现两个以上真正不同的调用方，才有理由引入新的公共抽象。
