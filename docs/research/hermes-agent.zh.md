# 【冻结源码快照】Hermes Agent 深度调研

> 本页只描述 `29d0cc2602e01943ab300c0382fc9d97efb376da`。当前远端身份只认
> [参考生态最新 revision 审计](ecosystem-latest-audit-2026-09-05.zh.md)，不能把本页当成当前 Hermes API 或
> EvoForge 运行时契约。

> 审计对象：[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent/tree/29d0cc2602e01943ab300c0382fc9d97efb376da)
> Revision：`29d0cc2602e01943ab300c0382fc9d97efb376da`
> 分支状态：`main...origin/main`，审计时工作树干净
> 本文基于本地源码、测试和仓库文档，重点分析整体架构与 self-improvement loop。

## 1. 结论先行

Hermes Agent 是一个产品完成度很高的 Python 通用 Agent：它把终端、模型 Provider、工具、Skill、长期记忆、会话检索、消息平台、Cron、子 Agent 和多种执行环境组合成一个可长期常驻的个人 Agent。它最有辨识度的产品主张是“closed learning loop”：从对话中保存记忆、创建或修改 Skill，再由 Curator 做整理、归档与回滚。[README](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/README.md#L19)

但 Hermes 当前更准确的定位是：

> 一个会持续整理记忆和操作说明的 Agent，而不是一个能够证明自身能力持续提高的进化系统。

原因不是它缺少“自动修改”，恰恰是自动修改很多；真正缺少的是修改前后的因果比较、未见样本、独立评价、精确版本晋升和效果回归检测。它把 reflection、使用次数和模型判断当作学习信号，却没有可靠回答“新版本是否比旧版本更好”。

对 EvoForge 而言，Hermes 值得继承的是：

- 学习在旁路运行，不阻塞前台会话；
- Memory、Skill、Session Search 分工明确；
- 用户能够查看、暂停、Pin、归档和回滚；
- Gateway 与 Cron 让 Agent 真正常驻并进入日常生活；
- 对 Provider、缓存、多执行环境和插件安全有大量工程处理。

必须超越的是：

- 从“反思后直接修改”升级到“候选 → 配对试验 → 晋升/复核/拒绝”；
- 从全局可变 Skill 目录升级到会话固定的版本代；
- 从活动统计升级到任务结果和回归集；
- 从 daemon thread 的 best-effort 后台工作升级到可恢复的有限状态；
- 从同一个 Agent 自提案、自评审升级到确定性检查优先的评价。

## 2. 整体心智模型

Hermes 的主体不是插件树，而是一个大型宿主程序加若干注册表：

```text
CLI / TUI / Messaging Gateway / Cron
                ↓
             AIAgent
                ↓
     system prompt + messages + tools
                ↓
        OpenAI-compatible Provider
                ↓
           tool call loop
                ↓
 Tool Registry → terminal / files / web / browser /
                 memory / skill / delegation / cron
                ↓
 SQLite Session DB + FTS5 / Memory stores / Skill files
```

仓库开发文档也把 `run_agent.py` 的 `AIAgent` 描述为核心，把工具、Gateway、SQLite 状态和 Agent 内部模块围绕它组织。[CONTRIBUTING](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/CONTRIBUTING.md#L218)

### 2.1 主控制流

`AIAgent` 的入口仍位于大型 `run_agent.py` 中，具体循环逐渐拆到 `agent/` 下的辅助模块。[AIAgent](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/run_agent.py#L412) [conversation loop](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/conversation_loop.py#L1494)

一次用户消息大体经过：

1. 解析当前 Profile、模型、工具集、Memory 和 Skill；
2. 构建或复用 system prompt；
3. 从会话状态得到消息历史；
4. 调用兼容 OpenAI 协议的 Provider；
5. 若模型产生 tool calls，通过中央注册表分派；
6. 将结果送回模型并继续迭代；
7. 得到最终回答，写入 SQLite；
8. 需要时做压缩、Memory 同步和后台 Skill/Memory review。

这是一套成熟的多轮 tool-use loop，但它的长期自治单位仍然主要是“一个会话/一次 Cron 执行”，没有像 DSH 那样把 Session 事实、Goal 领域、能力 Provider 和生命周期 Service 分成统一插件图。

### 2.2 Prompt 与 KV Cache

Hermes 对 Prompt Cache 有明确工程意识：

- `AIAgent` 缓存 system prompt，而不是每轮完全重建；[agent_init.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/agent_init.py#L1619)
- 技能目录有单独的 system-prompt cache；[prompt_builder.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/prompt_builder.py#L1477)
- 派生标识避免随机 UUID 破坏前缀稳定；[run_agent.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/run_agent.py#L4758)
- Anthropic 适配器会保留和迁移 `cache_control` 标记；[anthropic_adapter.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/anthropic_adapter.py#L1813)
- 后台复盘在同模型路径重放完整历史以复用温缓存，换模型时才生成短 digest。[background_review.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/background_review.py#L26)

这比许多 Agent 项目更成熟。但它仍有结构性矛盾：Skill、Memory、插件 prompt section 和上下文文件都是 system prompt 的组成来源；后台修改这些文件会使以后请求的前缀变化。Hermes 优化了“如何命中当前缓存”，却没有把“一个活动会话固定使用哪一代能力”建模为不可变契约。

## 3. 工具、权限与执行环境

### 3.1 Tool Registry

工具通过中央 `ToolRegistry` 注册和分派；Schema、handler、toolset、要求和来源被集中管理。[registry.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/registry.py#L426) [register](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/registry.py#L737) [dispatch](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/registry.py#L1102)

优点：

- 工具发现、Schema 和执行有统一入口；
- toolset 允许 CLI、Gateway 或任务选择不同工具集合；
- 插件工具最终进入同一注册表；
- 可对工具做来源、覆盖和依赖检查。

不足：

- 很多工具依靠 import-time self-registration，初始化顺序和全局状态较重；
- Tool Registry 是宿主中央机制，而不是 DSH 那种带作用域、依赖激活和 disposer 的统一生命周期图；
- 大量能力仍直接依赖 `AIAgent`、ContextVar 或全局单例，测试和卸载需要额外清理。

### 3.2 权限

危险命令由规则、session approval、永久 allowlist 和 Gateway/CLI 回调共同控制。审批支持 once、session、always、deny、timeout，并包含连续拒绝的 circuit breaker。[approval.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/approval.py#L2319)

这是面向真实用户产品的实用设计：消息平台上的审批也能阻塞危险命令并被 `/approve`、`/deny` 解除。

局限在于权限主要围绕命令危险模式，而不是统一的 capability/effect 权限模型。工具、插件、MCP、平台动作和 terminal backend 各自还有专门规则；长期扩展会产生多套相似但不完全一致的授权语义。

### 3.3 执行环境

`BaseEnvironment` 抽象了 local、Docker、SSH、Singularity、Modal、Daytona 和 Vercel Sandbox 等终端后端。[base.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/environments/base.py#L595)

这是 Hermes 的重要长处：同一个 Agent 可以在本机、远端、容器和 serverless 环境执行任务，产品使用场景远超单一 coding CLI。

但这些环境主要是 terminal execution adapter，不等于整个 Agent、插件和外部效果都进入相同安全边界。是否安全仍取决于具体工具是否经由相应环境，以及插件是否可以接触宿主能力。

## 4. Session、Memory 与跨会话召回

### 4.1 SQLite 是主状态

Hermes 已把 `state.db` 作为会话主存储，SQLite 中保存 Session 和消息，并用 FTS5 做跨会话搜索；JSON snapshot 默认关闭，只为外部兼容保留。[hermes_state.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/hermes_state.py#L1)

优点：

- 会话可检索、可继续、有标题和 lineage；
- FTS5 支持大规模历史召回；
- 对 FTS 索引损坏、重建、CJK tokenizer、并发写和维护做了大量防御；
- `session_search` 可以按相关片段而不是整段历史召回。

不足：

- `hermes_state.py` 与搜索扩展体量巨大，SQLite 同时承担会话、检索、Gateway 路由及多种产品状态，维护面很宽；
- 会话恢复、压缩、Memory 和 Gateway 还有额外状态文件与 sidecar，事实来源不像 DSH Session Event Log 那样统一；
- 跨会话“找到相关文本”不等于形成带验证、冲突和版本的长期知识。

### 4.2 Memory Provider

`MemoryProvider` 定义了 Memory 后端抽象，`MemoryManager` 负责 Provider 生命周期、system prompt 注入和同步。[memory_provider.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/memory_provider.py#L104) [memory_manager.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/memory_manager.py#L364)

仓库包含多种 Memory Provider，并明确要求新第三方 Provider 作为独立插件发布，而不是继续进入主仓库。[CONTRIBUTING](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/CONTRIBUTING.md#L70)

Memory、Session Search 和 Skill 的设计分工值得借鉴：

- Memory：用户是谁、稳定偏好和长期事实；
- Session Search：过去发生了什么；
- Skill：某类任务应该怎样做。

问题在于实际后台提示会把用户偏好同时写入 Memory 和任务 Skill，个人偏好容易污染本应可移植的通用程序性知识。[background_review.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/background_review.py#L246)

## 5. Gateway、Cron 与常驻自治

`GatewayRunner` 统一管理 Telegram、Discord、Slack、WhatsApp、Signal 等消息适配器，处理会话路由、流式输出、审批、Cron 和平台生命周期。[gateway/run.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/gateway/run.py#L6269)

`SessionStore` 把平台、chat、thread 与 Agent session 关联，使同一 Agent 能从消息渠道持续交互。[gateway/session.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/gateway/session.py#L1238)

Cron 能创建独立执行、保存输出并投递回平台，也为执行建立可搜索的 Session。它对 thread/DM/channel continuity 做了大量工程处理。[cron/scheduler.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/cron/scheduler.py#L3425)

长处：

- 真正解决“Agent 在哪里常驻、如何被日程唤醒、结果发到哪里”；
- 通道、Session、审批与定时任务形成完整产品闭环；
- 适合个人助理、日报、监控和消息自动化。

不足：

- Gateway、Cron、Session 和 Agent 生命周期主要通过大型宿主模块及 ContextVar 协调，理解成本和耦合较高；
- 定时执行常建立新的执行 Session，缺少一个统一、可持久恢复的原生 Goal 连续体；
- 后台 review 使用 daemon thread，进程退出时任务可以直接消失；[run_agent.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/run_agent.py#L1803)
- 大量 best-effort 和异常吞掉策略保护主会话，却会让后台自治的失败难以成为可靠状态。

Hermes 在“常驻入口和消息触达”上强，在“一个长期目标经过崩溃后可证明地继续”上仍不够深。

## 6. 插件系统

### 6.1 来源和覆盖

插件来自四类来源：

1. 仓库内 bundled；
2. `~/.hermes/plugins` 用户插件；
3. 项目 `.hermes/plugins`；
4. `hermes_agent.plugins` Python entry point。

同名用户插件可以覆盖 bundled 插件。[plugins.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/hermes_cli/plugins.py#L1)

目录插件包含 `plugin.yaml` 和 Python 入口。Manifest 支持版本、依赖、配置 Schema、能力声明、事件声明、Skill namespace 等。[PluginManifest](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/hermes_cli/plugins.py#L1031)

### 6.2 PluginContext

`PluginContext` 为插件提供：

- 工具和 Hook 注册；
- 插件私有配置及有配额的原子 JSON 状态；
- cleanup callback 与受监督后台 task；
- LLM facade；
- 子 Agent；
- MCP allowlist；
- 平台动作；
- Skill 和 system-prompt section 等扩展能力。

相关入口见 [PluginContext](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/hermes_cli/plugins.py#L1388)。

值得肯定：

- 插件有独立配置命名空间和持久状态；
- 工具覆盖默认禁止，需要显式授权；[plugins.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/hermes_cli/plugins.py#L1713)
- MCP 默认无权限，必须 operator allowlist；[plugins.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/hermes_cli/plugins.py#L1820)
- 后台任务与 cleanup 被记录，有比普通 Python import 更清晰的所有权；
- 项目明确要求第三方产品集成 out-of-tree 发布。[CONTRIBUTING](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/CONTRIBUTING.md#L90)

主要不足：

- 依赖和事件声明部分仍是 advisory；缺失依赖通常警告后继续加载，而不是像 Cordis `inject` 那样控制激活；[plugins.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/hermes_cli/plugins.py#L1082)
- 插件最终汇入全局 Tool、Hook 和宿主 Manager，隔离与作用域弱于 DSH 的 fiber/context；
- Python 插件拥有较强宿主能力，Manifest capability 不能单独构成进程级安全边界；
- Plugin Manager 自身接口很宽，新增能力容易继续扩大 facade。

Hermes 的插件系统是“功能丰富的宿主扩展接口”；DSH 更接近“运行时本身由可逆插件组成”。

## 7. Skill 与持续学习

### 7.1 前台 Skill 行为

system prompt 要求 Agent 在复杂任务、棘手修复或新工作流后保存 Skill，并在发现 Skill 过时或错误时立即 patch。[prompt_builder.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/prompt_builder.py#L194)

`skill_manage` 支持创建、整体编辑、patch、删除和管理 references/templates/scripts/assets。[skill_manager_tool.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/skill_manager_tool.py#L1)

正面价值：

- Agent 能把一次性解决过程沉淀为可重用程序；
- Skill 包不只是一段提示词，可以包含脚本、模板与参考材料；
- 写前读取、路径和归属 guard 降低误改风险；
- `/learn` 提供显式的用户驱动学习入口。[learn_prompt.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/learn_prompt.py#L1)

### 7.2 后台 Review

默认每累计约十次工具迭代会触发 Skill review，Memory 则按用户轮次计数。Review 在回答完成后启动，因此不占用前台 Agent 的注意力。[turn_finalizer.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/turn_finalizer.py#L732)

同模型时，它继承完整历史以利用温缓存；不同模型时改用摘要。工具白名单限制为 Memory 和 Skill 管理。[background_review.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/background_review.py#L1)

这是一个非常好的产品交互选择：学习默认旁路，用户不会因为“等待复盘”而被卡住。

但 Prompt 明确要求“多数 session 至少做一次更新”，把 no-op 描述为错失学习机会。[background_review.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/background_review.py#L182) 这会产生系统性 mutation bias：模型倾向于找到东西可写，而不是先证明内容值得长期保留。

### 7.3 Curator

Curator 每隔一段时间在空闲期运行：

- 统计 Skill 的 view/use/patch；
- 按时间从 active → stale → archived；
- 可选用 LLM 合并重叠 Skill、建立 umbrella；
- 支持 Pin、adopt、archive、restore、backup 和 rollback；
- 输出每轮报告。

设计与用户命令见 [Curator 文档](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/website/docs/user-guide/features/curator.md#L1)。

值得继承：

- 自治修改有 ownership：后台只能碰 curator-managed Skill；
- bundled、hub、external、pinned 有不同保护级别；
- 归档代替自动删除；
- 有 dry-run、报告和用户可见的恢复入口；
- Cron 引用会保护 Skill，合并时会迁移引用。

核心问题：

1. **触发不是效果。** Tool iteration 多不代表产生了可推广经验。
2. **使用不是质量。** view/use/patch 统计衡量活动，不衡量任务是否更成功。[skill_usage.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/skill_usage.py#L146)
3. **同源偏差。** 同一段对话和经常同一个模型负责提出并执行修改。
4. **没有 baseline。** 修改前后没有在相同任务上做配对比较。
5. **没有未见回归集。** 触发改进的案例可能通过，但其他场景是否退化未知。
6. **强制整理配额。** Consolidation Prompt 把少于十次 archive 视为停止过早。[curator.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/curator.py#L545)
7. **直接改变活动库。** 候选不是隔离版本，修改完成后即成为未来加载内容。
8. **回滚粒度粗。** Curator 备份整个 Skill 树；快照失败仍继续变更。[curator.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/agent/curator.py#L1546)
9. **安全扫描默认关闭。** 理由是 Agent 可通过 terminal 做同类操作，说明控制面并未真正收口。[skill_manager_tool.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/skill_manager_tool.py#L57)
10. **归属字段混义。** `created_by: agent` 实际同时被当作“允许自治维护”的 policy flag，而非可靠 provenance。[skill_usage.py](https://github.com/NousResearch/hermes-agent/blob/29d0cc2602e01943ab300c0382fc9d97efb376da/tools/skill_usage.py#L485)

因此 Hermes 的循环可以证明“知识库持续发生变化”，不能证明“Agent 能力持续改善”。

## 8. 设计长处

1. **通用 Agent 产品闭环完整。** CLI、TUI、Gateway、消息渠道、Cron、Memory、Skill 和 Session Search 真正组合到一起。
2. **Provider 和执行环境丰富。** 用户不被单一模型、云或本地环境锁定。
3. **会话检索实用。** SQLite + FTS5 比把所有过去对话塞入 Prompt 更可扩展。
4. **学习不阻塞前台。** Memory/Skill review 在回答完成后旁路执行。
5. **Skill 包模型合理。** 程序、脚本、模板、资料可以共同形成一项能力。
6. **自主维护有用户控制。** Pin、adopt、archive、dry-run、report 和 rollback 提供了可见性。
7. **插件工程较成熟。** 多来源、配置 Schema、依赖顺序、状态配额、cleanup、后台任务、MCP allowlist 和覆盖保护齐全。
8. **缓存意识强。** System prompt cache、Skill cache、Provider cache marker 和同模型复盘复用都经过专门设计。
9. **个人助理能力强。** 消息平台、Cron 和常驻 Gateway 是 coding harness 常缺少的产品层。

## 9. 主要不足

### 9.1 架构

- 核心文件体量很大：`run_agent.py`、`hermes_state.py`、`cron/scheduler.py`、`hermes_cli/plugins.py` 都承担多个领域。
- 注册表、ContextVar、Manager 和 import-time side effect 并存，生命周期不是一个统一机制。
- 多处 best-effort 异常吞掉保护主流程，但后台失败不总能形成耐久、可查询、可重试的状态。
- PluginContext 很宽，插件化更多是宿主暴露能力，而不是宿主本身被深插件组合。
- Session、Memory、Skill、Cron、Gateway route 和插件状态各有存储，跨领域事实容易分散。

### 9.2 长时自治

- 常驻 Gateway 和 Cron 解决“能被唤醒”，没有完全解决“同一个目标在崩溃后继续”。
- 后台 review 和部分异步工作是进程内 daemon/best-effort。
- 没有统一 Goal completion evaluator、资源预算和进度停滞判定。
- 审批在无人响应时仍可能成为长任务停点；timeout 能结束等待，但不能自动形成安全的替代路线。

### 9.3 持续进化

- 变化频率被误当作学习积极性；
- 模型 reflection 被误当作效果证据；
- Skill 使用次数被误当作价值；
- 缺少版本化候选、配对 Trial、独立硬门、未见回归集和精确晋升；
- 当前会话没有显式 Capability Generation；
- 自动修改没有和 Git 版本、测试证据、缓存 delta 绑定；
- 归档/合并解决目录卫生，不解决能力质量。

### 9.4 安全与可移植性

- Python 插件和 terminal 能力使“扫描 Skill”不是完整安全边界；
- 用户偏好可能进入任务 Skill，降低跨用户和开源可移植性；
- 第三方插件依赖声明部分 advisory，缺失时仍可能进入降级运行；
- 动态 Skill/Prompt 修改会改变后续上下文，缺少会话版本固定。

## 10. 对 DSH 和 EvoForge 的借鉴

### 10.1 应直接吸收

- 学习和复盘默认旁路，不延迟当前回答；
- Memory、历史召回、Skill 的职责分离；
- Skill 使用 references/templates/scripts/assets 的包结构；
- 用户显式 `/learn` 与后台自动发现并存；
- owned / installed / pinned / external 的清晰归属；
- dry-run、报告、Pin、Pause 和 Rollback UX；
- Gateway、消息 Adapter、Cron 和投递目标的产品思路；
- 多 Provider 与多执行环境；
- 同模型复盘利用温缓存、异模型使用短摘要的成本意识；
- 插件私有状态、cleanup ownership、MCP allowlist 和工具覆盖保护。

### 10.2 不应照搬

- 不按固定工具调用次数强制学习；
- 不用“多数 Session 都应修改”驱动后台模型；
- 不允许模型反思后直接 patch 活动 Skill；
- 不用 view/use/patch/recency 证明能力；
- 不让同一模型的主观总结独立决定晋升；
- 不用整个 Skill 树快照作为主要版本系统；
- 不在备份失败后继续自动变更；
- 不在活动会话中热切换模型可见能力；
- 不把个人偏好写入可发布的通用 Skill；
- 不为持续进化复制一个平行 Session、Goal 或 Agent Runtime。

### 10.3 上位替代方向

EvoForge 的 `dsh-evolve` 应保留 Hermes 的旁路体验，但把内部机制替换为：

```text
真实结果
→ compact Learning Signal
→ Git 中的 inactive candidate
→ active/candidate paired Trial
→ promote / review / reject
→ future-session Capability Generation
→ post-promotion monitoring
→ precise rollback
```

评价顺序应是权限与安全不变量、确定性测试、用户验收、纠正/返工、成本与 KV Cache，最后才是盲测模型判断。

指令型 Skill 在证据明显时可以自动晋升；模糊结果进入不阻塞会话的 review inbox；插件代码、脚本、权限和外部动作只生成 commit/Draft PR，不自动激活。

## 11. 最终评价

Hermes 最强的地方不是单个算法，而是它认真完成了“一个 Agent 如何进入日常生活”：常驻、消息、Cron、Memory、Skill、检索、插件和用户控制都能工作在同一产品里。这些是 EvoForge 做通用自治时最值得学习的部分。

Hermes 最弱的地方则正好位于其最响亮的主张：它把持续改变称作持续进化，却没有把“更好”变成可重复验证的工程事实。

因此，EvoForge 不需要比 Hermes 更频繁地学习，而需要做到：

> 每一次晋升都有来源、有对照、有硬门、有未见案例、有缓存测量、有权限边界、有版本，并且随时可以准确回滚。
