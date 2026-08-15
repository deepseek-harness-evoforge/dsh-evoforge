# Claude Code Rev 源码审计：行为参考，而非可信源码基线

> 审计对象：[`zhaoquan219/claude-code-rev`](https://github.com/zhaoquan219/claude-code-rev/tree/64915d730218363acba49e5454dc01c31e3986b1)
> 审计 revision：`64915d730218363acba49e5454dc01c31e3986b1`
> 工作树状态：`main...origin/main`，审计时干净
> 审计日期：2026-08-15
> 结论等级：可用于理解 Claude Code 的恢复后结构和行为设计；不可作为 Anthropic 上游源码、精确实现或安全性质的可信基线。

## 1. 最重要的判断

这个仓库不是 Claude Code 的上游源码，而是第三方根据 source map 逆向恢复、再通过人工补全、兼容 shim 和降级实现拼成的工作区。

证据不是推测：

- README 明确写明代码树主要由 source map 恢复，并且“不是原始 upstream repository state”：[README.md](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/README.md#L8)。
- 包版本是 `999.0.0-restored`，描述也是 “reconstructed from source maps”：[package.json](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/package.json#L3)。
- README 承认 type-only 文件、构建期生成文件、私有包包装、native binding、动态资源等无法完整恢复：[README.md](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/README.md#L35)。
- 实际 Git remote 是 `zhaoquan219/claude-code-rev`；`package.json` 虽填写 Anthropic 仓库 URL，但这不是当前仓库的来源证明。
- SDK 的 `tool()`、`createSdkMcpServer()`、`query()` 和持久会话 API 仍直接抛出 `not implemented`：[agentSdkTypes.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/entrypoints/agentSdkTypes.ts#L73)。
- MCP Skill 获取函数固定返回空数组：[mcpSkills.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/skills/mcpSkills.ts#L1)。
- Chrome MCP、Computer Use 和若干 native 依赖使用本地 shim；README 也将其称为 compatibility/degraded implementation：[package.json](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/package.json#L24)。
- 内建插件注册表目前没有注册任何插件，只留下迁移脚手架：[bundled/index.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/plugins/bundled/index.ts#L20)。

因此本文严格区分三类结论：

1. **源码事实**：当前 revision 中能够直接定位的类型、控制流和数据结构。
2. **行为推断**：恢复代码足以支持、但不能证明与官方发行版完全一致的设计意图。
3. **不可验证声明**：README 所称“可运行”等状态。本地环境缺少 Bun，`bun run version` 和 `bun run dev:restore-check` 均以 127 失败；仓库又没有根级 test/lint/build 脚本，因此本次不能独立验证完整可运行性和回归可靠性。

后续设计应学习它的控制面、接口边界和故障经验，而不是复制恢复代码，更不能把其中的安全判断当作已证明性质。

## 2. 总体架构

恢复后的系统大致可分为八层：

```text
Bootstrap / CLI
  ↓
Config、Trust、Feature Gates
  ↓
Plugin / Skill / Agent / MCP 发现与装配
  ↓
统一 Tool Pool 与权限上下文
  ↓
Headless Runner 或 Ink REPL
  ↓
Query Loop：模型流式响应 ↔ Tool Execution
  ↓
Hooks、Session JSONL、Artifacts、Compaction
  ↓
下一轮、恢复、子 Agent 或结束
```

入口很薄：`bootstrap-entry.ts` 初始化运行时宏后动态导入 CLI：[bootstrap-entry.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/bootstrap-entry.ts#L1)。CLI 又用动态 import 分流 `--version`、Chrome MCP、Computer Use、daemon worker、remote control 等快速路径，以降低普通启动的模块求值成本：[cli.tsx](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/entrypoints/cli.tsx#L28)。

主入口的关键职责是：

- 确定 interactive/headless 模式和 permission mode；
- 读取设置、环境、workspace trust 和企业策略；
- 提前并行读取 MCP 配置，但在交互模式中把真正连接延后到 trust 建立之后：[main.tsx](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/main.tsx#L1805)；
- 在命令和 Agent 扫描前注册 bundled skills 和 builtin plugin，避免并行初始化时缓存空集合：[main.tsx](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/main.tsx#L1925)；
- 构造内建工具池、插件内容、Agent 定义和 MCP 工具；
- 进入 Ink REPL，或把全部运行参数传给 `runHeadless`：[main.tsx](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/main.tsx#L2832)。

这是一套成熟的“交互式 Agent Loop + 丰富扩展面”，但不是 durable workflow engine。长期状态的主要抽象仍是 conversation/session，而不是可单独调度、租约化和重放的工作步骤。

## 3. 核心控制流：一次请求如何运行

`query()` 是异步生成器，真正的持续循环位于 `queryLoop`：[query.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/query.ts#L219)。单轮可以概括为：

1. 读取当前 messages、system prompt、tools、permission context、预算和依赖。
2. 每个用户 turn 预取 memory；每次循环预取 Skill discovery。
3. 只选择 compact boundary 之后仍有效的消息。
4. 对历史 tool result 做总量预算检查和已持久化 replacement 恢复。
5. 依次尝试 snip、microcompact、context collapse 和 autocompact。
6. 创建 `StreamingToolExecutor`，开始模型流式请求：[query.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/query.ts#L545)。
7. 流中出现 tool-use 时，进入工具执行、PreToolUse Hook、权限判定、真正 `tool.call()`、PostToolUse/Failure Hook。
8. 将 assistant message、tool result、progress/metadata 写入 transcript。
9. 若本轮没有 tool-use，则结束；否则将结果加入上下文并继续下一次模型调用。
10. 遇到上下文超限、最大输出、压缩失败等条件时进入专门恢复路径，而不是只让整个请求失败。

Tool 执行的关键顺序是“Hook 可以提出修改或阻断，但最终仍进入中央权限决策，再调用工具”。实际执行在：[toolExecution.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/services/tools/toolExecution.ts#L916)。

这条控制流的价值是把所有工具——包括 MCP 工具——纳入同一条验证、权限、Hook、结果记录和恢复管线。其代价是中央执行器、Tool 类型、Hook 输出和 AppState 之间耦合较深。

## 4. Tool：真正的运行内核协议

`Tool` 是这个系统最重要的统一接口。它不只描述“函数名和 JSON Schema”，还覆盖：

- `call()` 执行；
- 输入/输出 schema；
- `validateInput()`；
- 工具专属 `checkPermissions()`；
- `isConcurrencySafe()`；
- `isReadOnly()` 与 `isDestructive()`；
- 被新用户消息打断时是 cancel 还是 block；
- 是否 open-world、是否要求用户交互；
- 是否 MCP/LSP；
- 是否 deferred loading / always load；
- 最大结果尺寸和 artifact 落盘；
- permission matcher；
- UI 名称、进度、活动描述和结果渲染；
- 安全 classifier 输入和遥测可见输入。

完整接口见：[Tool.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/Tool.ts#L362)。`ToolResult` 还可以追加消息、修改后续 context，并透传 MCP `_meta/structuredContent`：[Tool.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/Tool.ts#L321)。

工具池组装有三个值得学习的动作：

1. 先执行 blanket deny，把被禁止的工具从模型可见集合中删除，而不是等调用后拒绝：[tools.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools.ts#L262)。
2. 再按模式、环境、平台和 feature gate 过滤。
3. 合并内建与 MCP 工具，按稳定分区排序并去重，名称冲突时内建工具优先：[tools.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools.ts#L329)。

### 值得借鉴

- 能力、执行、安全属性和生命周期有共同协议。
- 禁止能力在进入模型 prompt 前就消失，减少误调用和无意义 token。
- 大结果可持久化为 artifact，只把预览和引用返回模型。
- deferred tool discovery 可以控制初始工具 schema 体积。
- `backfillObservableInput` 明确保护原始 API-bound input，避免修改 prompt-cache 对应内容：[Tool.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/Tool.ts#L474)。

### 不可照搬

这个接口过胖：执行、policy、UI、telemetry、prompt-cache 和 MCP 适配都挤在一个类型中。对真正“一切皆插件”的 DSH，更适合保留 DSH 原生 Tool 服务边界，把插件内部实现拆为 capability metadata、execution、policy 和 presentation；不要复制一个新的平行 Tool 抽象。

## 5. Plugin：扩展面丰富，但并非“一切皆插件”

恢复代码中的外部 Plugin 可以贡献：

- commands；
- agents；
- skills；
- hooks；
- output styles；
- channels；
- MCP servers；
- LSP servers；
- user config；
- 少量 allowlisted settings。

Manifest 总 schema 见：[schemas.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/plugins/schemas.ts#L884)。加载器既支持 `.claude-plugin/plugin.json`，也能按约定目录自动发现 commands、agents、skills、output styles 和 hooks。

来源优先级是：

```text
managed policy
  > session --plugin-dir
  > marketplace installed plugin
  > builtin plugin
```

企业 managed 设置能阻止本地 `--plugin-dir` 覆盖受管插件：[pluginLoader.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/plugins/pluginLoader.ts#L2995)。启动消费者默认使用 cache-only loader，避免交互启动被 marketplace 网络和 git clone 阻塞；显式刷新才运行 full loader：[pluginLoader.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/plugins/pluginLoader.ts#L3111)。加载完成后会检查依赖，把缺依赖插件降级为 disabled，但依赖目前是 presence check，不是拓扑启动图：[pluginLoader.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/plugins/pluginLoader.ts#L3189)。

它仍不是严格意义的“一切皆插件”：

- 外部插件没有 code-native `tools` 组件；新增工具主要经 MCP 接入。
- 核心工具仍在 `getTools()` 中硬编码装配。
- builtin plugin 类型只接受 skills、hooks、MCP servers 等少数组件：[plugin.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/types/plugin.ts#L18)。
- `PluginComponent` 联合没有 MCP、LSP 和 settings，与 `LoadedPlugin` 能承载的字段不一致：[plugin.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/types/plugin.ts#L48)。
- 插件 settings 当前只允许 `agent` 一个键：[schemas.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/plugins/schemas.ts#L852)。
- 内建插件注册函数当前没有注册任何实际插件。
- 错误类型注释承认生产中实际只用了两个粗粒度错误，其他类型仍是计划项：[plugin.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/types/plugin.ts#L86)。

对 DSH/EvoForge 最有价值的是来源优先级、受管策略、缓存优先启动、依赖降级和可失效缓存；不应复制其“核心仍硬编码、插件只包外围内容”的边界。

## 6. Skill：内容能力与隔离执行的中间层

默认注册的 bundled skills 包括：

- update-config
- keybindings
- verify
- debug
- lorem-ipsum
- skillify
- remember
- simplify
- batch
- stuck

按 feature gate 或环境可能额外注册：dream、hunter、loop、schedule-remote-agents、claude-api、claude-in-chrome、run-skill-generator。注册事实见：[skills/bundled/index.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/skills/bundled/index.ts#L24)。

Skill 元数据支持 `allowedTools`、固定 model/effort、禁止模型主动调用、`context: fork`、指定 Agent、Hooks、附带文件和条件路径激活。文件加载覆盖 managed、user、project、`--add-dir` 和 legacy commands；还会沿 cwd 向上发现，距离当前目录更近的 Skill 可覆盖远处定义：[loadSkillsDir.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/skills/loadSkillsDir.ts#L923)。

安全细节值得注意：Skill 引用文件会创建 0700 临时目录，使用 `O_NOFOLLOW | O_EXCL`，并拒绝路径穿越：[bundledSkills.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/skills/bundledSkills.ts#L118)。本地 Skill 可以做 inline shell expansion，但 MCP Skill body 明确不执行 inline shell。`context: fork` 会启动隔离 Agent，而不是简单把 Skill 文本拼到主上下文：[SkillTool.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools/SkillTool/SkillTool.ts#L118)。

恢复工程的限制是 MCP Skill 路径实际拿不到数据，因此只能把调用结构视为设计参考。

## 7. Agent：能力裁剪和生命周期隔离

Agent 定义支持：

- tools / disallowedTools；
- prompt、model、effort；
- permission mode；
- MCP servers；
- hooks；
- max turns；
- skills；
- memory；
- background；
- worktree isolation。

定义 schema 见：[loadAgentsDir.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools/AgentTool/loadAgentsDir.ts#L56)。Agent 覆盖顺序是 builtin → plugin → user → project → CLI flag → managed，后来源覆盖前来源：[loadAgentsDir.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools/AgentTool/loadAgentsDir.ts#L193)。

`runAgent` 的生命周期比较完整：[runAgent.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools/AgentTool/runAgent.ts#L248)

1. 连接 Agent 专属 MCP，并记录需要清理的客户端。
2. fork 或裁剪父上下文，克隆 file cache。
3. 对只读 Agent 省略无关 CLAUDE.md 和 git status，降低上下文成本。
4. 应用 Agent 级权限；异步 Agent 遇到需要交互的权限默认拒绝，除非有上浮机制。
5. 运行 SubagentStart Hook。
6. 预加载 Agent 所需 Skills。
7. 合并 Agent MCP 工具并建立独立 ToolUseContext。
8. 使用 sidechain transcript 执行 query loop。
9. 退出时清理 MCP、Hooks、缓存、文件、Todo 和后台 shell 任务。

这体现了“子 Agent 是带 capability set 的隔离执行单元”，而不只是另一个 prompt。

但它仍主要是父进程内的一次 Agent run。background Agent 使用不与父 abort 绑定的控制器，这有利于后台继续，也意味着可靠取消、进程崩溃恢复和失控治理必须由更高层承担。代码中没有证据证明它具备跨进程 heartbeat、幂等 step replay 或持久 Goal supervisor。

对 EvoForge 的启示不是再造一个 Agent Runtime，而是让 DSH 原生 Subagent、Goal、Workflow、Session、Jobs 和 Schedule 承担运行；插件只增加可测量的新工作流或 Completion Check。

## 8. Hook：最值得借鉴的扩展契约

Hook 事件面覆盖：

- PreToolUse、PostToolUse、PostToolUseFailure；
- Notification、UserPromptSubmit；
- SessionStart、SessionEnd；
- Stop、StopFailure；
- SubagentStart、SubagentStop；
- PreCompact、PostCompact；
- PermissionRequest、PermissionDenied；
- Setup；
- TeammateIdle；
- TaskCreated、TaskCompleted；
- Elicitation、ElicitationResult；
- ConfigChange；
- WorktreeCreate、WorktreeRemove；
- InstructionsLoaded、CwdChanged、FileChanged。

事件枚举见：[coreTypes.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/entrypoints/sdk/coreTypes.ts#L25)。Hook 实现包括 shell command、prompt、HTTP、Agent verifier、SDK/internal function callback：[hooks.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/schemas/hooks.ts#L31)。

Hook 输出不只是日志，可以：

- block / prevent continuation；
- 修改 tool input/output；
- 修改 permission decision；
- 向后续模型上下文增加内容；
- 异步执行，并在特定退出条件后重新唤醒 Agent。

配置来源会合并 snapshot、registered hooks 和当前 session hooks；managed-only 设置能禁止插件及 Skill/Agent frontmatter 绕过策略：[hooks.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/hooks.ts#L1492)。

安全边界很明确：交互模式下所有 Hook 都要求 workspace trust，因为它们能够执行任意本地命令：[hooks.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/hooks.ts#L267)。然而非交互模式被视为隐式可信：[hooks.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/hooks.ts#L286)，这对无人值守、处理不可信仓库的长期 Agent 是明显风险。

对 DSH 最值得吸收的是“版本化事件契约 + typed result”，而不是 Hook 直接执行宿主 shell 的权限模型。EvoForge 应优先复用 DSH Hooks；无变化的 Hook 必须真正 no-op，不能为观察状态持续改写模型可见前缀。

## 9. MCP：把外部能力适配进统一 Tool 控制面

MCP 类型支持 local、user、project、dynamic、enterprise、claudeai、managed 等 scope，以及 stdio、SSE、HTTP、WebSocket、SDK、claude.ai proxy 等 transport：[mcp/types.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/services/mcp/types.ts#L10)。

客户端层处理：

- 连接缓存；
- OAuth 和 needs-auth；
- capabilities、instructions、tools、prompts、resources；
- tool 名称清理和 namespace；
- `_meta`、annotations 和 structured content；
- terminal error 后关闭与缓存失效；
- tools/prompts/resources 并行获取；
- MCP server 级 permission rule。

实际价值是 MCP 工具被适配为普通 `Tool` 后，会经过相同的可见性过滤、权限、Hook、执行记录和结果持久化，而不是形成第二条不受控通道。

需要警惕：远端 MCP server 自报的 read-only/destructive annotations 是元数据，不是可信安全证明。宿主仍必须用自己的权限、审批、网络/文件系统 sandbox 和 Protected Action 边界强制约束。恢复代码里的 MCP Skills 又是 stub，所以不能据此证明完整协议兼容。

## 10. Session：append-only JSONL、消息 DAG 与 sidechain

主 Session 采用 append-only JSONL。每条消息有 `uuid/parentUuid`，形成可分支的消息 DAG；Subagent 写入独立的：

```text
<session>/subagents/agent-<id>.jsonl
```

消息定义和 sidechain 约定见：[sessionStorage.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/sessionStorage.ts#L128)。

设计长处包括：

- transcript 目录 0700、文件 0600；
- 每个文件独立写队列和批量 append；
- progress message 不进入 parent chain，避免孤立真实消息；
- compact boundary 可设置逻辑父节点为空；
- metadata 可在 compaction 和退出时重新 append；
- content replacement/context collapse 作为单独记录恢复；
- 重建消息链时检测 cycle，并处理并行 tool branch；
- resume 可以恢复 file history、attribution、Todo、自定义 Agent、model、worktree 和 cache。

恢复入口见：[conversationRecovery.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/conversationRecovery.ts#L416)，运行态恢复见：[sessionRestore.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/sessionRestore.ts#L95)。

设计债务也很明显：

- 代码注释承认 transcript 可能达到数 GB；
- JSONL 同时承担日志、恢复、分支、metadata-last-wins 和内容替换；
- 大量修复路径是为历史孤链、并行分支和 metadata 顺序问题兜底；
- 状态重建依赖扫描和解释日志，而不是清晰的版本化 snapshot contract。

EvoForge 不应因此建立第二套事件溯源或 Workflow 数据库。项目基线要求复用 DSH Session Persistence、Goal、Storage、Jobs、Schedule 和 Workflow。可借鉴的是 append-only evidence、明确 sidechain 和可恢复 checkpoint；实现必须落在 DSH 原生接缝内，并保持状态少量、幂等、可删除。

## 11. Compaction：让上下文继续生存，不等于持续进化

压缩是分层防线：

```text
tool-result budget
→ snip
→ microcompact
→ context collapse
→ autocompact
→ 超限后的 reactive compact
```

主循环入口见：[query.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/query.ts#L365)。`compactConversation()` 会触发 PreCompact，生成 summary 和 compact boundary，再恢复必要运行状态：[compact.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/services/compact/compact.ts#L387)。恢复内容包括近期文件、异步 Agent、plan、Skills、deferred tools、Agent 列表和 MCP instructions；随后重新触发 SessionStart compact 与 PostCompact。媒体内容会先转换为文本 marker，附件和 Skill 恢复都有单项及总量预算。

Autocompact 还有连续失败计数和三次失败 circuit breaker：[autoCompact.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/services/compact/autoCompact.ts#L51)。

这是高质量的“上下文生存”设计，但不能证明 Agent 在持续进化：

- summary 是有损转换；
- 它没有 falsifiable improvement claim；
- 没有 active/candidate 配对 Trial；
- 没有 Promotion、Capability Generation 和 rollback；
- 不能保证失败经验、用户纠正和测量结果被可靠提炼；
- “记住了”与“变得更好”仍是两回事。

对 EvoForge，应把 Compaction 保持为 DSH Core 的上下文职责；Evolution Loop 只消费 compact、可追溯的 Learning Signal，不复制完整 transcript，也不把反思文本直接激活为新能力。

## 12. 权限、Workspace Trust 与 Sandbox

权限行为是 `allow | deny | ask`。外部可选模式包括 default、plan、acceptEdits、dontAsk、bypassPermissions，内部还可能有 auto/bubble：[permissions.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/types/permissions.ts#L16)。

中央权限顺序值得学习：

1. 先检查全工具 deny。
2. 再检查全工具 ask。
3. 调用工具自己的 `checkPermissions()`。
4. 工具级 deny 立即生效。
5. 内容级 ask rule 即使在 bypass mode 也保留。
6. `.git/`、`.claude/`、`.vscode/`、shell config 等 safety check 对 bypass 免疫。
7. 然后才应用 permission mode 和 always-allow rule。
8. 无法自动决定时把 passthrough 转成 ask。

关键实现见：[permissions.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/permissions/permissions.ts#L1158)。后台/无 UI Agent 无法弹权限框时，会先让 PermissionRequest Hook 决策；仍无决定则自动 deny，而不是静默 allow：[permissions.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/permissions/permissions.ts#L929)。

Bash 安全比简单命令 allowlist 深得多。主路径优先使用 tree-sitter AST；若命令含 substitution、expansion、control flow 或 parser differential，无法静态证明安全则 ask：[bashPermissions.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools/BashTool/bashPermissions.ts#L1663)。后续还包括：

- exact/prefix/wildcard rule；
- command injection 检查；
- 重定向路径验证；
- 子命令 fanout 上限；
- compound `cd + git` 防 bare-repo sandbox escape；
- tree-sitter 不可用时的 legacy regex/shell-quote fallback；
- control char、IFS、`/proc/*/environ`、Unicode whitespace、zsh module、heredoc 和 quoting differential 检查。

但强边界并非默认成立：

- `CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK` 可关闭 AST 注入检查：[bashPermissions.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools/BashTool/bashPermissions.ts#L1678)。
- OS sandbox 默认 `enabled ?? false`：[sandbox-adapter.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/sandbox/sandbox-adapter.ts#L459)。
- `allowUnsandboxedCommands` 默认 true：[sandbox-adapter.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/sandbox/sandbox-adapter.ts#L474)。
- sandbox 初始化失败默认记录日志后降级，而不是无条件 fail closed：[sandbox-adapter.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/utils/sandbox/sandbox-adapter.ts#L782)。
- `--print` 跳过 trust，并应用可能来自不可信来源的完整环境变量；代码只通过帮助文本警告调用者目录必须可信：[main.tsx](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/main.tsx#L2590)。
- 非交互模式的 Hook、LSP 和其他执行路径把 trust 视为隐式成立。

因此安全机制可以作为“多层防御案例库”，不能作为“默认安全的无人值守执行器”照搬。EvoForge 必须继续使用 DSH 原生 Approval、Permission Preset、FS/Shell 和 Sandbox；merge、release、生产部署、secret、付费操作和不可逆外部动作仍是 Protected Action，Evolution Loop 不得绕过。

## 13. KV Cache：做对的地方与风险

Claude Code Rev 没有一份独立“KV Cache 架构”，但代码中能看到多个明确优化：

### 正向设计

- CLI 使用动态 import 和快速路径，减少无关模块与启动开销。
- 工具池在合并后稳定排序，注释明确提到 prompt-cache stability：[tools.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/tools.ts#L329)。
- 被 deny 的工具在模型看到 schema 前过滤，避免无效 schema 进入前缀。
- deferred tools 只在需要时加载；`alwaysLoad` 只留给首轮必须可见的能力：[Tool.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/Tool.ts#L439)。
- Tool observer 输入的回填不修改原始 API-bound input，明确保护 prompt cache：[Tool.ts](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/Tool.ts#L474)。
- 只读 Subagent 可省略 CLAUDE.md/git status；普通 Subagent 还会关闭 thinking 以节约成本。
- fork-agent compact 尝试共享 cache，避免每个子任务从完全不同前缀开始。
- 大 Tool Result 落盘，防止结果体积直接破坏上下文。

### 风险与边界

- Plugin、MCP、Skill、Agent 和 feature gate 来源很多，若在会话中动态变化，工具名、schema、排序和 system context 都可能漂移。
- Hooks 可以追加上下文或修改 tool input/output；若无事发生时仍产生内容，会打断稳定前缀。
- Compaction 必然改变消息前缀，只能把它作为超限时的必要边界，而不是频繁状态同步机制。
- MCP 指令、动态 Skill discovery 和连接状态如果每轮全量注入，会造成缓存抖动；恢复代码通过预取、deferred tool 和 compact rehydrate 缓解，但没有形成跨插件强制契约。
- 大量 build-time/runtime feature gate 让不同构建和会话的实际工具面难以推理。

EvoForge 的 Cache Contract 比复制这些局部技巧更重要：同一 DSH Session 固定 Capability Generation；模型可见工具名、schema、顺序和稳定指令不因后台学习变化；动态状态用现有稳定工具按需读取；无变化 Hook 真正 no-op；Promotion 只影响后续 Session；缓存效果以完整 composition 测量。

## 14. 对长时间自治的真实评价

Claude Code Rev 已具备若干“长时间继续运行”的零件：

- max turns、美元预算和 task budget：[main.tsx](https://github.com/zhaoquan219/claude-code-rev/blob/64915d730218363acba49e5454dc01c31e3986b1/src/main.tsx#L2844)；
- background Agent 和 shell task；
- Agent max turns、memory、worktree 和 sidechain transcript；
- session resume、fork 和文件状态恢复；
- tool result artifact 化；
- layered compaction 和超限恢复；
- async Hook reawake；
- feature-gated cron/loop/remote agent 能力；
- MCP terminal error 清理和有限重连；
- compaction circuit breaker。

这些能力解决的是：单进程中运行更久、上下文不爆、子任务能分离、会话可以恢复。

它没有被当前恢复源码证明的部分包括：

- host process 崩溃后自动识别并继续一个未完成的高层 Goal；
- 每一步的幂等 checkpoint 和明确完成条件；
- 任务长期无进展时的健康判定、暂停和人工接管；
- 真实软件开发流程的内核级 completion gate；
- 从任务结果生成候选能力、配对评测、晋升和回滚；
- 可证明的长期资源上限与失控防护。

此外，它的 planning 主要体现为 Todo、plan mode、Task/Agent 和预算，不存在与 DSH Goal 对等的、用户可见且可持久监督的单一长期目标对象。不要把“query loop 能继续”误判为“自治闭环已经完成”。

EvoForge 应依照既定范围补足用户结果，而不是建立平行 Runtime：

- 软件交付用 Software Delivery Pack 组合 DSH Goal、Worktree、FS/Shell、Workflow、Approval 和 Draft PR；
- 完成可信度用小而明确的 Completion Check；
- 单机崩溃恢复以后置 Goal Supervisor 复用 DSH Session Persistence、Goal、Jobs、Schedule 和 Storage；
- 持续进化用 Learning Signal → Evolution Candidate → Trial → Promotion → Capability Generation；
- 不增加 Mission、任务 DAG、通用事件平台、分布式 lease 或第二套审批语言。

## 15. 架构长处

1. **统一控制面**：内建工具与 MCP 最终经过同一 Tool、权限、Hook、记录和恢复链路。
2. **权限顺序明确**：deny 和 bypass-immune safety check 先于宽松 mode。
3. **Hook 事件丰富**：适合审计、验证、审批、异步协作和插件扩展。
4. **Subagent 生命周期完整**：能力裁剪、独立 MCP/Skill/Memory、sidechain 和 cleanup 都有明确位置。
5. **上下文生存能力强**：多层压缩、artifact 化、恢复附件和 circuit breaker 能延长有效工作时间。
6. **插件启动工程化**：来源优先级、managed policy、cache-only loader、依赖降级和缓存失效较成熟。
7. **Session 可恢复性强于纯聊天数组**：append-only JSONL、parentUuid DAG 和 sidechain 能表示分支与恢复。
8. **安全工程经验密集**：Bash parser differential、bare git repo、路径和环境变量等防护体现大量真实漏洞反馈。
9. **对 prompt cache 有工程意识**：稳定工具排序、deferred loading、原始输入不变和 fork cache sharing 都是实用优化。

## 16. 架构不足与证据边界

1. **恢复工程不完整**：SDK、MCP Skills、native/Chrome/Computer Use 存在 stub 或 degraded path。
2. **缺少可执行验证基线**：没有 test/lint/build 脚本和测试目录，本次环境也没有 Bun。
3. **插件不是内核构成单元**：核心 Tool 仍硬编码，内建插件为零，code-native tools 不能直接作为插件组件。
4. **Tool 接口过胖**：执行、policy、UI、telemetry、classifier 和 cache 细节耦合。
5. **feature gate 复杂**：大量 build-time/runtime 分支使实际能力面难以静态说明。
6. **非交互隐式 trust**：对 CI、SDK 和无人值守运行形成高风险默认。
7. **Sandbox 可选且可降级**：默认不启用，缺失时通常不是 fail closed。
8. **Session 承担职责过多**：消息日志、恢复、metadata、replacement 和分支共享一种 JSONL 表达。
9. **Compaction 有损**：解决 token 生存，不提供知识真实性和进化证明。
10. **没有持续进化闭环**：记忆、Skill 生成和反思都不能替代配对 Trial、Promotion 和 rollback。
11. **没有可证明的跨进程长期监督**：background run 不等于 Goal 级崩溃恢复。
12. **第三方 MCP 元数据不可当权限事实**：宿主仍需强制能力和副作用边界。

## 17. 对 DSH / EvoForge 的可借鉴点

以下是行为和原则层面的借鉴，不是源码移植建议。

| Claude Code Rev 经验 | DSH / EvoForge 对应做法 |
|---|---|
| 所有工具进入统一执行与权限管线 | 复用 DSH 原生 Tool、Approval、Permission Preset、FS/Shell/Sandbox，不建平行 Tool Runtime |
| deny 在模型可见之前过滤 | composition 阶段裁剪能力；会话内保持工具名、schema 和排序稳定 |
| 丰富生命周期 Hook | 使用 DSH Hook/Cordis effect，事件结构版本化；无变化时严格 no-op |
| Subagent 有独立 capability set 和 cleanup | 复用 DSH Subagent/Workflow/Scope，插件卸载和任务结束时由 Cordis 生命周期释放资源 |
| Plugin cache-only startup 和 managed precedence | 插件发现与安装分离；启动只读已安装版本；明确 owner/policy 优先级 |
| Tool Result artifact 化 | 大证据放 DSH Storage/Artifact，只把稳定摘要和引用送入模型 |
| Session append-only 与 sidechain | 复用 DSH Session Persistence；Learning Signal 只保存紧凑事实和来源引用 |
| Compaction 后重新水合运行状态 | 由 DSH Core 负责 context；插件动态状态通过稳定工具按需读取 |
| Bash AST + fail-to-ask + OS sandbox | 继续使用 DSH 原生权限与 Sandbox；复杂/不可证明命令进入审批 |
| background 能力与异步 Hook | 后台 Evolution Loop 不阻塞原 Session，候选保持 inactive |
| cache 稳定排序与 deferred tools | 贯彻 Cache Contract；Capability Generation 在 Session 建立时冻结 |
| 安全修复源于真实攻击路径 | 每个高权限插件建立 adversarial tests、Protected Action 和 rollback 验证 |

特别值得保留的设计原则是：**统一控制面、显式生命周期、失败可见、不可证明即收紧、恢复后重新建立必要运行状态**。

## 18. 不可照搬的部分

- 不复制恢复源码、private-product 分支或 feature gate 迷宫。
- 不把“当前代码存在”当作官方 Claude Code 精确行为。
- 不新建巨型 Tool 接口覆盖 DSH 原生 Service。
- 不把核心工具硬编码后仍宣称“一切皆插件”。
- 不让插件 Hook 默认以宿主权限执行任意 shell。
- 不把 headless/CI/SDK 模式自动视为可信工作区。
- 不允许 sandbox 缺失时静默扩大权限。
- 不凭 MCP server 自报 annotations 自动批准副作用。
- 不把 conversation JSONL 变成 EvoForge 的第二套 Workflow 数据库。
- 不把 Compaction summary、模型反思、复用次数或模型信心当成 Learning Signal 的充分证据。
- 不在活动 Session 内热改 Skill、Prompt、Tool schema 或插件版本。
- 不为了补 Claude Code 的缺口而在 DSH 上建立 Mission、任务 DAG、Effect Broker、分布式 lease 或平行事件溯源。
- 不把修复 DSH Core Defect 包装为 Feature Extension；应生成最小复现并反馈上游。

## 19. 最终评价

Claude Code Rev 最有价值的不是“恢复出了多少 Claude Code 源码”，而是暴露了一套经过大量产品迭代后的控制面：统一 Tool、分层权限、Hook 生命周期、Subagent 隔离、Session 恢复、上下文压缩、MCP 适配和缓存优化。

它同时揭示了一个上限：把 conversation loop 做得再强，也只会得到一个更能持续运行的 Agent；如果没有真实结果、可证伪候选、active/candidate Trial、原子 Promotion、不可变 Capability Generation 和 rollback，就不能称为持续进化。

对 DSH/EvoForge 的正确用法是：

1. 把它作为行为参考和故障经验库；
2. 用 DSH 原生 Cordis、Goal、Session、Tool、Approval、Storage、Jobs、Schedule、Workflow、Skill、Subagent 和 Sandbox 承载实现；
3. 只新增 upstream-fixed 后仍有独立用户价值的 Feature Extension；
4. 用 Software Delivery Pack 和 Completion Check 建立第一条可测量闭环；
5. 用 Cache Contract、Protected Action、Trial 和 rollback 把“长时间运行”提升为“可验证、可解释、可回滚的持续进化”。

简言之：**学它的控制面和生命周期，不信任恢复代码的精确性；借它延长 Agent 的运行，用 DSH 原生接缝和 EvoForge 的证据闭环超越它的进化上限。**
