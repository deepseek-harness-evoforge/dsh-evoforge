# DSH、Claude Code Rev、Hermes Agent 跨项目比较

> 比较基线：DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`、Claude Code Rev `64915d730218363acba49e5454dc01c31e3986b1`、Hermes Agent `29d0cc2602e01943ab300c0382fc9d97efb376da`。
> Claude Code Rev 是第三方 source-map 恢复工程，不能当作 Anthropic 上游源码；相关结论仅描述当前本地恢复仓库。

## 1. 一句话定位

| 项目 | 最准确的定位 | 最值得学习的部分 | 最大缺口 |
|---|---|---|---|
| DeepSeek Harness | 产品内核高度插件化的 Agent Runtime | Cordis 生命周期、能力接缝、可重放 Session、组合式配置、KV Cache 纪律 | 仍是 RC；长时 Goal 的常驻接管、独立评价和持续进化尚未闭环 |
| Claude Code Rev | Claude Code 的第三方逆向架构化石 | Tool/Hook/Permission 控制面、软件开发 UX、压缩后运行状态补水 | 恢复不完整；插件不是内核构成单位；不是可靠生产源码基线 |
| Hermes Agent | 面向个人长期使用的通用常驻 Agent 产品 | Gateway、Cron、Memory、Skill、Session Search、学习 UX | 架构集中；学习循环会修改但不能证明改进 |

最合理的组合关系不是三选一：

- 用 DSH 作为底层 Runtime；
- 借鉴 Claude Code 的开发控制面和权限细节；
- 借鉴 Hermes 的常驻产品体验；
- 由 EvoForge 补上可验证、缓存稳定、可回滚的持续进化。

## 2. 架构形态

### DeepSeek Harness

DSH 的基本单位是 Cordis Plugin。Service Definition 声明能力接缝，Provider 提供实现，Consumer 只依赖接缝，Bundle/配置决定实际组合。插件注册、事件监听和资源清理由 fiber/effect 统一管理。

优势是“替换能力不用修改消费者”；代价是包、插件、配置 row 和作用域数量较多，初学者需要先理解服务图而不是顺序启动脚本。

### Claude Code Rev

Claude Code Rev 围绕 query loop、Tool protocol、Hook event、permissions、Session JSONL 和 UI/CLI 组织。核心工具仍由宿主显式构建，自定义能力主要通过 MCP、Skill、Agent、Hook 和 Plugin Manifest 进入。

它的控制面丰富，但不是“一切皆插件”：Tool 接口承担执行、权限、安全、展示、遥测和缓存等多重职责，核心模块与大量 feature gate 紧密相连。

### Hermes Agent

Hermes 以大型 `AIAgent` 为中心，Tool Registry、Plugin Manager、Gateway、Cron、Session DB、Memory Manager 和 Skill 系统围绕宿主协作。插件拥有丰富的宿主 facade，但生命周期机制并不统一。

它更像“完整应用加插件接口”，而 DSH 更像“应用本身由插件组合”。

## 3. 插件化与扩展边界

| 维度 | DSH | Claude Code Rev | Hermes |
|---|---|---|---|
| 核心能力是否插件化 | 高；Agent Loop、LLM、FS、Shell、Sandbox、Persistence 等可组合 | 中；Plugin 扩展 commands/agents/skills/hooks/MCP 等，核心 Tool 仍硬编码 | 中；工具与插件可扩展，但都汇入宿主管理器 |
| 依赖激活 | `inject` 决定 fiber 激活/卸载 | Loader 解析来源和依赖，缺失时多为降级 | 依赖排序存在，但部分 advisory，缺失仍加载 |
| 生命周期 | Cordis effect/disposer 统一 | 各模块/Agent run 自行 teardown | Plugin cleanup/task ownership + 各子系统清理 |
| 作用域 | 全局与 `agent.ctx` 可 shadow | 主会话、Agent、Plugin 来源层级 | Profile、Gateway Session、ContextVar 和全局 Registry |
| Provider 可替换性 | Definition/Provider/Consumer 是正式纪律 | MCP/Tool adapter 较强，但核心接口较胖 | Model、Memory、Environment 较强，其他能力依赖宿主 facade |
| out-of-tree 方向 | 天然适合 | Marketplace/Plugin/MCP | 明确鼓励第三方集成独立插件仓库 |

结论：EvoForge 应遵循 DSH 的 Service/Provider 纪律；从 Hermes 学习插件所有权和私有状态；从 Claude Code 学习插件来源优先级和企业策略，但不复制巨型 Tool 接口。

## 4. Session、Goal 与长期运行

### Session

- **DSH**：可重放事件日志是模型上下文、UI、持久化、fork 和审计的共同事实源；“model-visible means logged”是一条强不变量。
- **Claude Code Rev**：append-only JSONL 通过 `uuid/parentUuid` 表达 DAG，支持 resume、sidechain、compact boundary 和文件历史恢复，但一个日志格式承担了过多职责。
- **Hermes**：SQLite 是 canonical session store，FTS5 负责跨会话检索；Gateway routing、Memory 和其他状态仍分散在额外领域。

### Goal/任务

- **DSH**：有持久 Goal 状态和 rounds，但 activation 是进程态；原生 Goal 适合继续增强。
- **Claude Code Rev**：围绕当前 prompt、plan、task/agent run 工作，没有一个通用持久 Goal 领域。
- **Hermes**：Cron、会话和子任务能够长期触发，但缺少统一的 Goal 连续体。

### 崩溃恢复

- **DSH** 有最干净的 Session 事实和冷恢复基础，但 Jobs、Workflow 和 Goal 自动接管仍不完整。
- **Claude Code Rev** 能恢复对话和压缩状态，但缺少持久 workflow lease/checkpoint。
- **Hermes** 的 Gateway/Cron 可由服务进程常驻，部分后台 review 仍是 daemon/best-effort。

结论：EvoForge 不应新增 Mission，应复用 DSH Goal 和 Session，在其上增加单机、有限、可恢复的监督与 Evolution 后台状态。

## 5. 上下文、压缩与 KV Cache

### DSH

DSH 通过 Session 日志重建模型请求，工具和提示词组成由插件组合决定；项目文档明确要求插件说明 token 与 KV Cache 影响。稳定前缀、追加式历史和一致工具顺序是核心优势。

### Claude Code Rev

它有多层上下文治理：

```text
tool-result budget
→ snip
→ microcompact
→ context collapse
→ autocompact
→ reactive compact
```

压缩后会补回 plan、文件、Skill、Agent、MCP 和 deferred tools。优点是运行连续性强；不足是 summary 仍不能保证目标、经验和评价语义无损。

### Hermes

Hermes 缓存 system prompt、Skill catalog，支持 Provider cache marker；后台复盘同模型时利用完整温前缀，异模型才生成 digest。问题是 Skill/Memory 可被后台热修改，缺少每 Session 固定能力代。

结论：EvoForge 的所有插件必须共同遵守 Cache Contract。持续进化不进入前台 Prompt，候选保持 inactive，Promotion 只影响后续 Session。

## 6. Tool、权限和安全

### Claude Code Rev 最强的部分

- Tool 有 `validateInput`、`checkPermissions`、只读/破坏性、并发和中断等属性；
- deny 在模型看到 Tool 之前过滤；
- Hook 可以拦截 Pre/Post/Failure/Permission/Compact/Agent 生命周期；
- Bash 权限采用 AST、fail-to-ask、重定向检查和 sandbox。

问题是非交互隐式 trust、sandbox 可降级和 Tool 接口过胖，不适合直接复制。

### DSH 的优势

机制拆分得更干净：Tool Registry、Approval、Sandbox Policy、Sandbox Provider、FS/Shell Provider 和 Credentials 是不同插件。它更适合表达“谁负责什么”，但需要上层组合提供好用的默认权限体验。

### Hermes 的优势

Gateway 上的危险命令也能进入审批往返，session/permanent allowlist、timeout 和拒绝 circuit breaker 很实用。插件 Tool override 与 MCP access 默认受限。

结论：底层使用 DSH 原生 Approval/Sandbox/Permission Preset；借鉴 Claude 的 pre-model filtering 和 Bash 分析；借鉴 Hermes 的跨消息平台审批 UX。EvoForge 不建立平行 Policy 平台。

## 7. Skill、Memory 和持续进化

| 能力 | DSH | Claude Code Rev | Hermes |
|---|---|---|---|
| Skill | Provider Registry，可从文件系统和其他来源发现 | Skill 支持 tools/model/hooks/fork agent 等丰富配置 | Skill 可由 Agent 创建、修改，含 references/templates/scripts/assets |
| Memory | 原生重点是 Session/Skill；长期语义 Memory 交给插件生态 | CLAUDE.md/auto memory/session resume，机制依产品分支 | 多 Memory Provider、USER/MEMORY、Session Search |
| 自动学习 | 无完整闭环 | Skillify/Remember 等能力，不构成持续评价 | Background Review + Curator |
| 评价 | Goal 目前无独立 evaluator | Hook 可拼验证，但无统一晋升模型 | 使用/查看/修改/时间 + LLM 判断 |
| 版本晋升 | 无 | 无统一能力版本代 | Tree backup/restore，非 paired promotion |

Hermes 最接近“持续进化”，但它的循环是：

```text
达到工具次数
→ 重放对话
→ 模型找学习点
→ 直接写 Skill
→ 按使用和时间整理
```

EvoForge 需要替换为：

```text
真实结果
→ Learning Signal
→ inactive Git candidate
→ paired Trial
→ promote / review / reject
→ immutable future-session generation
→ measured rollback
```

持续进化的评价事实应来自测试、用户验收、纠正/返工、权限不变量、成本和缓存；模型 reflection 只产生候选。

## 8. 软件开发交付

### Claude Code Rev

软件开发体验最成熟：worktree、plan、Agent、Hook、文件工具、Bash 权限、compact rehydrate 和 PR 工作流共同构成较顺滑的 coding agent。

### DSH

底层能力更适合组合：FS、Shell、LSP、Sandbox、Goal、Workflow、Subagent 和 Approval 都是可替换插件；但用户可直接采用的完整“Goal → worktree → tests → commit → Draft PR”能力包仍需要扩展。

### Hermes

通用工具足够做开发，也有 Issue-to-PR 等 Skill，但产品重心更偏通用个人 Agent；软件交付的统一完成门和仓库隔离不如专门 coding agent 清晰。

结论：EvoForge 的 Software Delivery Pack 应借鉴 Claude Code 的流程体验，以 DSH 原生能力实现，并作为 Evolution Loop 的第一组强评价数据。

## 9. 个人助理与外部消息

Hermes 明显领先：Gateway、Telegram/Discord/Slack/WhatsApp/Signal、Cron、投递和语音等已经构成日常自治产品。

DSH 提供构建这些能力所需的 Schedule、Jobs、Web、Credentials、Approval 和插件生命周期，但缺少同等成熟的消息渠道产品包。

Claude Code 的主场是软件开发，不适合作为通用个人助理蓝本。

结论：EvoForge 后续的消息、内容、日程和个人助理包主要参考 Hermes 的用户体验，但每个渠道作为独立 out-of-tree 插件，不合并成一个巨型 Gateway。

## 10. 可观测性、测试与维护

- **DSH**：源码覆盖、文档生成、配置目录、工具目录、能力图和包约束非常严格；这对开放插件生态尤其重要。
- **Claude Code Rev**：恢复仓库没有完整测试脚本，许多 stub 和 fallback 使结论只能作为设计参考。
- **Hermes**：测试量大、对跨平台和大量历史问题有回归覆盖，但核心模块体量和状态组合也非常大。

EvoForge 应采用 DSH 的契约测试纪律，并为每个插件额外验证：

- 加载、卸载、重复加载；
- scope 和依赖消失；
- model-visible surface snapshot；
- KV Cache composition delta；
- 崩溃和恢复；
- 权限拒绝；
- 版本晋升与回滚。

## 11. 最终取舍

### 以 DSH 为基础

因为它在三者中最符合：

- 一切能力可组合；
- 生命周期统一；
- Provider 可替换；
- Session 可重放；
- 每 Agent 可独立作用域；
- KV Cache 可作为架构不变量。

### 从 Claude Code Rev 借控制面

重点吸收：

- 工具在模型可见前过滤；
- Hook 事件覆盖完整；
- Bash 权限和 sandbox 多层防御；
- compact 后明确补水；
- worktree、Agent、plan 和开发 UX。

不复制其恢复代码、巨型 Tool interface、非交互隐式 trust 和 feature-flag 内核。

### 从 Hermes 借产品体验

重点吸收：

- 常驻 Gateway、Cron 和消息触达；
- Memory/Session Search/Skill 分工；
- 旁路学习；
- Pin、Pause、Report、Review、Rollback；
- 多 Provider、多执行环境和插件私有状态。

不复制其强制变更倾向、活动统计评价、直接修改 active Skill 和粗粒度回滚。

### EvoForge 的独特位置

EvoForge 不应成为第四个 Agent Runtime。它的产品公式是：

> DSH 的插件化 Runtime
> + Claude Code 的可信开发控制面
> + Hermes 的常驻通用 Agent 体验
> + 可验证、非阻塞、缓存稳定、可回滚的持续进化。

这四项中，前三项已有可学习实现；第四项是 EvoForge 应形成独特开源价值的地方。
