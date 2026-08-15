# DeepSeek Harness 原生插件全目录（171）

> 审计 revision：`47f943859bef60e4160492346772ded9b24f765a`
> 审计日期：2026-08-15
> 统计范围：[`deepseek-harness/packages/*/*`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages) 的 Host/Client Cordis entry；不含 vendored Cordis 插件、native binary、纯 library 和不可直接加载的抽象 Definition。
> 本文只记录当前已存在插件；“建议新增”与路线图不在本目录中。

## 1. 统计口径

仓库共有 219 个 `packages/*/*` 包，源码核验后的互斥分类是：

| 类型 | 数量 | 说明 |
|---|---:|---|
| 可加载 Cordis 插件 | **171** | 本文逐项列出 |
| 抽象 Service Definition | **15** | 声明能力接口，部署加载具体 Provider，不直接挂载 |
| Library | **33** | 由其他包 import，不能作为 `cordis.yml` entry |
| 合计 | **219** | 与 workspace 包数一致 |

171 个可加载插件再分为：

- **168 个产品插件**；
- **2 个 example**：`dsh-acp-demo`、`dsh-agent-spine-demo`；
- **1 个 replay 测试插件**：`dsh-llm-replay`。

生成的 [Config Catalog](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/config-catalog.md#L4) 当前只列出 105 个有 Config 插件和 65 个无 Config 插件，并把 `dsh-typert-registry` 错列为 library，所以表面总数是 170。源码实际通过 [registry/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/typert/registry/src/index.ts#L13) re-export 默认 `Service`，且 [base bundle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/base/cordis.patch.yml#L24) 会加载它。漏项来自生成器只识别本文件 default 声明/assignment，未识别 `export { default } from`：[gen-config-catalog.ts](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/scripts/gen-config-catalog.ts#L546)。因此本文采用源码与真实组合核验后的 **171**，不凑数，也不照抄生成器误分类。

15 个不可直接加载的抽象 Definition 为：`attachment`、`code-runtime`、`compaction`、`credentials`、`fs`、`host-directory-picker`、`jobs`、`sandbox`、`session-persistence`、`session-query`、`settings`、`shell`、`spill`、`subprocess`、`workflow`。其证据目录见 [config-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/config-catalog.md#L3094)。另有一些可加载的 registry 型插件也承担 Definition/owner，例如 `dsh-llm`、`dsh-web`、`dsh-subagent`、`dsh-terminal`。

## 2. 表格图例

### 角色

- `D:key`：Service Definition、registry 或该 Context service 的 owner；
- `P:key`：Provider；
- `C:key`：Consumer；
- `Tool`：模型工具 Consumer；`Policy`：事件/执行策略；
- `Bundle`：组合分发或 app runtime glue；
- `Client`：浏览器 Cordis 插件；`Host/Gateway`：Host 或协议边界；
- 一个插件可以同时拥有多个角色。正式 service 关系以生成的 [Capability Seam 表](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/capability-seams.md#L412) 为准。

### 装载与 Config

- `B/W/H`：官方 Base / Web / Headless Bundle；
- `S/C/M/X`：Standard / Code / Minimal / Cordis Agent Preset；
- `Opt`：原生包存在但官方主组合默认不挂载；
- `cfg`：有可设置 Config；`—`：没有 Config。

Web 会禁用部分 Base 的全局 Agent-plane row，再由 Agent Preset 在精确 `agent.ctx` 内重挂载；因此 `B+S` 表示“Base 定义且 Standard Agent 作用域使用”，不表示同一个 Web Agent 同时获得两份注册。

### 模型与 KV Cache

- `M0`：无直接模型可见内容；
- `MP`：改变 System Prompt/固定请求前缀；组合与配置不变时稳定；
- `MT`：增加工具 Schema；工具集合不变时稳定；
- `MA`：调用结果或上下文作为 Session 后缀追加，保留既有前缀；
- `MR`：替换已有模型历史，从 replacement point 起失去复用；
- `MD`：运行时可能改变工具/Prompt 表面，必须特别审计缓存；
- `UI`：只影响浏览器投影。

## 3. 全量目录

### ACP（1）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-acp` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/acp/acp/src/index.ts#L1) | 通过 JSON-RPC stdio 自动化驱动 DSH Agent | `C:agents`、`P:approval`、Gateway | `Opt; cfg` | `M0` | 协议入口；只为其 Agent 回答审批，不是通用 UI |

### API 与 Typert（4）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-api-gateway` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/api/gateway/src/index.ts#L1) | Typert Remote 的 Host dispatcher 与 Client API endpoint | `C:typert`、`D:typertGateway`、Gateway | `B; —` | `M0` | 进程内路由；依赖生成契约 |
| `@deepseek-ai/dsh-api-remotes` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/api/remotes/src/index.ts#L1) | 组装 Host Agent/Session 的 Remote BFF 与查找策略 | Gateway | `W; —` | `M0/UI` | Web Host 边界，不拥有 Session 事实 |
| `@deepseek-ai/dsh-typert-loader` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/typert/loader/src/index.ts#L1) | 把生成的 Typert 包贡献加载进 registry | `C:typert`、开发基础设施 | `B; cfg` | `M0` | 反射/Schema 装载；错误应在启动期暴露 |
| `@deepseek-ai/dsh-typert-registry` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/typert/registry/src/index.ts#L1) | 运行时反射与 Zod Schema registry | `D:typert` | `B; —` | `M0` | 真实可加载；Config Catalog 当前漏分 |

### Attachment（1）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-attachment-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/attachment/attachment-local/src/index.ts#L1) | DSH_HOME 下私有 content-addressed 附件存储 | `P:attachments` | `B; cfg` | `M0` | 持久内容；模型适配器按授权引用解析，不直接注入正文 |

### Bundle（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-headless` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/headless/src/index.ts#L1) | 无 HTTP/浏览器的一次性 Agent/Session runner | `Bundle`、`C:agentDefaultModel` | `H; cfg` | `MP` | 进程生命周期结束即退出；持久性取决于底层 Persistence |
| `@deepseek-ai/dsh-web-app` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/web-app/src/index.ts#L1) | Web Bundle runtime glue、前端静态资源、Web Prompt 与 Shell 环境 | `Bundle` | `W; cfg` | `MP` | Web 专用；组合变化会改变前缀/Client 图 |

### Core 与 Runtime Diagnostics（8）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-agent` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent/src/index.ts#L1) | Agent 接口、live registry、initiator scope 与事件词汇 | `D:agents`、`C:sessions,invariants` | `B; —` | `M0` | live handle 进程内；Session 事实另行持久化 |
| `@deepseek-ai/dsh-agent-default-model` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent-default-model/src/index.ts#L1) | 统一 Agent 入口的默认 ModelSelection | `D:agentDefaultModel` | `B; cfg` | `M0` | Settings 分层；选择变化影响后续请求路由 |
| `@deepseek-ai/dsh-agent-loop` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent-loop/src/index.ts#L1) | 默认 Turn/Step/LLM/Tool driver | `D:agentLoop`、`C:llm,sessions,persistence,prompt,tools,agents,invariants` | `B; cfg` | `M0` | 所有模型可见内容先写日志；可替换但属产品脊柱 |
| `@deepseek-ai/dsh-agent-tool-presentation` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent-tool-presentation/src/index.ts#L1) | 为一个 Agent 选择 native/code/both 工具表面 | `Policy:C:tools,codeRuntime` | `C; cfg` | `MP/MT` | Agent 发布前固定，活动 Session 内稳定 |
| `@deepseek-ai/dsh-session` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/session/src/index.ts#L1) | 事件溯源 SessionStore 与模型 surface | `D:sessions`、`C:invariants` | `B; —` | `MA` | 内存所有者；持久化由 Provider 监听/flush |
| `@deepseek-ai/dsh-system-prompt` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/system-prompt/src/index.ts#L1) | Prompt section、变量与工具 Schema 组装 registry | `D:systemPrompt` | `B; cfg` | `MP/MT` | 稳定 id/order 是缓存关键；配置变化改前缀 |
| `@deepseek-ai/dsh-tools` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/tools/src/index.ts#L1) | 工具 registry、Code Mode 与受保护执行管线 | `D:tools`、`C:prompt,approval,codeRuntime` | `B; cfg` | `MT/MA` | 工具集合定义前缀；call/result 写 Session |
| `@deepseek-ai/dsh-invariants` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/runtime-diagnostics/invariants/src/index.ts#L1) | 注册并运行包自有 runtime invariant | `D:invariants`、`C:sessions` | `Opt; cfg` | `M0` | 诊断/拒绝错误状态；不应作为业务 workaround |

### Code Runtime（1）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-code-runtime-worker-thread` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/code-runtime/code-runtime-worker-thread/src/index.ts#L1) | 在 worker thread 执行模型生成的 TypeScript/JavaScript Code Mode 程序 | `P:codeRuntime` | `W+H; cfg` | `M0` | Worker 是隔离机制而非恶意代码安全边界；调用仍回到工具策略管线 |

### Compaction（3）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-command-compact` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/compaction/command-compact/src/index.ts#L1) | 人工触发 Session 压缩的 slash command | Command、`C:commands,compaction` | `B+S+C+X; —` | `MR` | 仅入口；实际事务由 Compaction Provider 完成 |
| `@deepseek-ai/dsh-compaction-basic` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/compaction/compaction-basic/src/index.ts#L1) | token-pressure 与 overflow 驱动的 LLM summary 压缩 | `P:compaction`、`C:llm,tokenMeter,pruner` | `B+S+C+X; cfg` | `MR` | Durable replacement；失败保留原 surface，summary 可能有信息损失 |
| `@deepseek-ai/dsh-compaction-tool-result-pruner` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/compaction/compaction-tool-result-pruner/src/index.ts#L1) | 无模型的 tool-result head/middle/tail 裁剪 | `D:toolResultPruner` | `B+S+C+X; cfg` | `MR` | Replay-safe node replacement；只处理可裁文本 |

### Context（4）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-agent-instructions` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/context/agent-instructions/src/index.ts#L1) | 加载 `AGENTS.md`/`CLAUDE.md` workspace instructions | Prompt Consumer | `B+S+C+X; cfg` | `MP` | 文件/范围变化会改变前缀；应保持稳定且有边界 |
| `@deepseek-ai/dsh-session-reference` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/context/session-reference/src/index.ts#L1) | 把有界跨 Session snapshot 作为不可信 durable context | `D:sessionReferenceResolver`、`C:sessionQuery` | `Opt; cfg` | `MA` | 引用内容写日志；受 workspace authority 限制 |
| `@deepseek-ai/dsh-time-context` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/context/time-context/src/index.ts#L1) | 可选的当前时区时间与 elapsed context | Context Policy | `Opt; cfg` | `MA` | 每次注入都会累积；支持 refresh interval，默认主组合关闭 |
| `@deepseek-ai/dsh-tmux-context` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/context/tmux-context/src/index.ts#L1) | 可选 tmux session/window/pane 位置上下文 | Context、`C:shell` | `Opt; cfg` | `MA` | 仅状态变化时追加；不能读取 sibling pane 内容 |

### Preset（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-agent-presets` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/preset/agent-presets/src/index.ts#L1) | 从 preset `cordis.yml` 为每个 Session 组合 Agent | `D:agentPresets` | `W; cfg` | `MD` | Agent 发布前固定 composition；拒绝未激活或泄漏根 realm 的 row |
| `@deepseek-ai/dsh-persona` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/preset/persona/src/index.ts#L1) | 在 Agent scope shadow deployment Persona | Prompt Provider | `S+C+M+X; cfg` | `MP` | 仅可 scoped mount；对 Agent 生命周期前缀稳定 |

### LLM（5）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-llm` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm/src/index.ts#L1) | Provider-neutral LLM adapter registry 与 streaming 接口 | `D:llm` | `B; —` | `M0` | 不持久 Provider 内部状态；stream 结果由 Loop 记录 |
| `@deepseek-ai/dsh-llm-deepseek` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm-deepseek/src/index.ts#L1) | DeepSeek chat-completions Provider | `P:llm`、`C:settings,credentials` | `B; cfg` | `M0` | 网络/密钥边界；默认主 Provider |
| `@deepseek-ai/dsh-llm-pi-ai` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm-pi-ai/src/index.ts#L1) | pi-ai-backed DeepSeek 适配器，兼作设计验证 twin | `P:llm`、`C:attachments,settings,credentials` | `B; cfg` | `M0` | 需 Settings 路由启用；不应和主 Provider 混淆 |
| `@deepseek-ai/dsh-llm-retry` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm-retry/src/index.ts#L1) | 按 Provider 路由的请求重试策略 | Policy | `B; cfg` | `M0` | 只重试契约允许的失败；不是跨 Provider durable failover |
| `@deepseek-ai/dsh-token-meter` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/token-meter/src/index.ts#L1) | 从 replay surface 得到 revisioned token measurement | `D:tokenMeter` | `B; cfg` | `M0` | 每 Session isolated fold；供 Compaction 决策 |

### Filesystem（6）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-fs-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/fs-local/src/index.ts#L1) | 本地主机文件系统实现 | `P:fs` | `M; cfg` | `M0` | 不实施 sandbox policy；Minimal preset 明确选择它 |
| `@deepseek-ai/dsh-fs-observation-policy` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/fs-observation-policy/src/index.ts#L1) | 在 `fs/*` 事件门上加入 read-before-edit 与 version guard | `Policy`、Companion:`fs` | `B; —` | `M0` | 进程内观察状态；防陈旧写，不是内核隔离 |
| `@deepseek-ai/dsh-fs-sandbox` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/fs-sandbox/src/index.ts#L1) | 按 per-call sandbox mode 限制 write/edit | `P:fs`、`C:sandboxPolicy` | `B; cfg` | `M0` | 路径 fence，有 residual TOCTOU；读始终允许 |
| `@deepseek-ai/dsh-tool-fs` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/tool-fs/src/index.ts#L1) | 模型 read/write/edit 工具 | `Tool`、`C:tools,fs,systemPrompt` | `B+S+C+X; cfg` | `MT/MA` | 写入受 FS Provider/Approval；结果与 diff metadata 可 replay |
| `@deepseek-ai/dsh-tool-fs-search` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/tool-fs-search/src/index.ts#L1) | 基于打包 ripgrep 的 glob/grep 工具 | `Tool` | `B+S+C+X; cfg` | `MT/MA` | 有输出/匹配上限；发现工具不等于完整读取 |
| `@deepseek-ai/dsh-tool-str-replace-editor` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/tool-str-replace-editor/src/index.ts#L1) | view/create/literal replace/line insert 编辑器工具 | `Tool`、`C:fs` | `B+M; cfg` | `MT/MA` | 适合精确文本编辑；权限取决于 FS 实现 |

### Shell（8）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-bash-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/bash-local/src/index.ts#L1) | 通过 `ctx.subprocess` 执行本地 Bash | `P:shell`、`C:subprocess` | `Opt; cfg` | `M0` | 无 sandbox 包装；只应在信任组合使用 |
| `@deepseek-ai/dsh-bash-sandbox` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/bash-sandbox/src/index.ts#L1) | 对每条 Bash argv 应用 Sandbox Provider | `P:shell`、`C:subprocess,sandbox,sandboxPolicy` | `B; cfg` | `M0` | fail-closed；会报告 enforcement/denial 事实 |
| `@deepseek-ai/dsh-pwsh-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/pwsh-local/src/index.ts#L1) | 本地 PowerShell Shell Provider | `P:shell` | `Opt; cfg` | `M0` | Windows/PowerShell 环境；无 sandbox 包装 |
| `@deepseek-ai/dsh-pwsh-sandbox` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/pwsh-sandbox/src/index.ts#L1) | Sandbox 包装的 PowerShell Provider | `P:shell`、`C:sandbox,sandboxPolicy` | `B; cfg` | `M0` | Windows confinement 为 partial，不能视作完整安全边界 |
| `@deepseek-ai/dsh-shell-env` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/shell-env/src/index.ts#L1) | 管理可信 `DSH_*` shell 环境贡献 | `D:shellEnv` | `B; cfg` | `M0` | effect-scoped；Subprocess 会清洗环境中的凭据形态变量 |
| `@deepseek-ai/dsh-tool-bash` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/tool-bash/src/index.ts#L1) | 模型 Bash 工具，支持后台 Job 与一次性权限升级 | `Tool`、`C:tools,shell,shellEnv,approval,jobs,persistence` | `B+S+C+X; cfg` | `MT/MA` | 命令副作用；受 sandbox/approval；后台状态当前进程内 |
| `@deepseek-ai/dsh-tool-bash-persistent` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/tool-bash-persistent/src/index.ts#L1) | owner-scoped 持久 Bash 交互工具 | `Tool`、`C:terminals` | `M; cfg` | `MT/MA` | “持久”指进程内 PTY session，不跨 Harness 重启 |
| `@deepseek-ai/dsh-tool-pwsh` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/tool-pwsh/src/index.ts#L1) | 模型 PowerShell 工具 | `Tool`、`C:shell,shellEnv` | `B+S+C+X; cfg` | `MT/MA` | 平台条件启用；权限继承选定 Shell Provider |

### Subprocess（1）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-subprocess-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subprocess/subprocess-local/src/index.ts#L1) | 本地进程树、stdio、PTY 与 kill escalation 实现 | `P:subprocess` | `B; —` | `M0` | live 资源；清洗环境并在 owner/service teardown 清理进程树 |

### Terminal（3）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-terminal` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/terminal/terminal/src/index.ts#L1) | owner-scoped PTY session registry、send/read/signal/cleanup | `D:terminals` | `M; —` | `M0` | 会话进程内；Agent disposal 时清理 |
| `@deepseek-ai/dsh-terminal-bash` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/terminal/terminal-bash/src/index.ts#L1) | 基于 Subprocess PTY 的持久 shell backend | `P:terminals`、`C:subprocess,sandbox,sandboxPolicy` | `M; cfg` | `M0` | live PTY；遵循同一 sandbox mode |
| `@deepseek-ai/dsh-tool-terminal` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/terminal/tool-terminal/src/index.ts#L1) | 六个模型 PTY 控制工具 | `Tool`、`C:tools,terminals,jobs,systemPrompt` | `Opt; cfg` | `MT/MA` | owner 隔离；后台通知依赖 process-local Jobs |

### LSP（3）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-lsp` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/lsp/lsp/src/index.ts#L1) | 按语言/extension 选择 Provider 的 LSP registry | `D:lsp` | `Opt; —` | `M0` | 只暴露 definition/reference/implementation/hover 的标准化子集 |
| `@deepseek-ai/dsh-lsp-stdio` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/lsp/lsp-stdio/src/index.ts#L1) | 启动并翻译 stdio JSON-RPC language server | `P:lsp`、`C:subprocess` | `Opt; cfg` | `M0` | transient-open 文档；路径世界须与 FS/Subprocess 一致 |
| `@deepseek-ai/dsh-tool-lsp` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/lsp/tool-lsp/src/index.ts#L1) | 模型只读 LSP 查询工具 | `Tool`、`C:lsp` | `Opt; cfg` | `MT/MA` | 位置/hover 输出有界；不是任意 LSP escape hatch |

### Sandbox（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-sandbox-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/sandbox/sandbox-local/src/index.ts#L1) | 选择 bwrap/Landlock/Seatbelt/Windows ACL runner | `P:sandbox` | `B; cfg` | `M0` | 功能探测、不可用 fail-closed；部分平台仅 partial enforcement |
| `@deepseek-ai/dsh-sandbox-policy` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/sandbox/sandbox-policy/src/index.ts#L1) | 解析 deployment/session/per-call mode 与 workspace root | `D:sandboxPolicy` | `B; cfg` | `MP/MA` | policy context 可见；模式变更以 durable snapshot 反映 |

### Credentials 与 Settings（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-credentials-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/credentials/credentials-local/src/index.ts#L1) | 从 live env 与 `$DSH_HOME/.env` 解析 credential reference | `P:credentials` | `B; cfg` | `M0` | 值不进入配置/模型；每次操作解析，支持轮换 |
| `@deepseek-ai/dsh-settings-file` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/settings/settings-file/src/index.ts#L1) | `settings.yaml` 文件 Provider | `P:settings` | `B; cfg` | `M0` | 持久用户设置；消费者决定 live/restart 生效 |

### Interaction（5）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-commands` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/interaction/commands/src/index.ts#L1) | 插件拥有的人类 slash command registry | `D:commands` | `B; —` | `M0` | 命令直接分发，不自动开启模型 Turn |
| `@deepseek-ai/dsh-permission-presets` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/interaction/permission-presets/src/index.ts#L1) | 将 sandbox mode 与 approval policy 组合成用户预设 | `D:permissionPresets` | `B; cfg` | `MP/MA` | 选择写 Session 事件；不创造第二套权限语言 |
| `@deepseek-ai/dsh-tool-ask-user` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/interaction/tool-ask-user/src/index.ts#L1) | 模型向当前人类询问结构化问题 | `Tool`、`C:tools,userQuestions` | `S+C+X; —` | `MT/MA` | 无 UI answerer 时不可用；等待会暂停该工具调用 |
| `@deepseek-ai/dsh-user-approval` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/interaction/user-approval/src/index.ts#L1) | 一次性 allow/deny 的 approval waterfall | `D:approval` | `B; cfg` | `MP/MA` | 无 answerer fail-closed；决策有审计事件 |
| `@deepseek-ai/dsh-user-questions` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/interaction/user-questions/src/index.ts#L1) | 人机提问抽象 seam | `D:userQuestions` | `B; —` | `M0` | UI/ACP 提供 answerer；本包不呈现界面 |

### Goal、Plan、Todo 与 Schedule（7）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-command-goal` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/goal/command-goal/src/index.ts#L1) | 人工管理 persisted Goal 的 slash command | Command、`C:commands,goals` | `B; —` | `M0/MA` | 变更由 Goal Service 写入 Session |
| `@deepseek-ai/dsh-goal` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/goal/goal/src/index.ts#L1) | revisioned、事件溯源的同 Session Goal 状态机 | `D:goals` | `B; cfg` | `M0` | 状态 durable，continuation activation 进程内；仅一个 current Goal |
| `@deepseek-ai/dsh-goal-round-driver` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/goal/goal-round-driver/src/index.ts#L1) | 在 Turn 结束后 race-fenced 地推进下一 Goal round | Policy、`C:agents,goals,sessions` | `B; —` | `MA` | 受 maxGoalRounds；重启/resume 不自动 re-arm |
| `@deepseek-ai/dsh-tool-goal` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/goal/tool-goal/src/index.ts#L1) | get/create/update/complete/block Goal 工具 | `Tool`、`C:goals` | `B+S+C+X; cfg` | `MT/MA` | mutation 用 revision fence；没有独立完成 evaluator |
| `@deepseek-ai/dsh-plan-mode` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/plan/plan-mode/src/index.ts#L1) | logged Plan Mode、部署指导、`/plan` 与人工审核退出 | `D:planMode` | `B+S+C+X; cfg` | `MP/MT/MA` | 模式切换会改变指导/退出表面；状态写 Session |
| `@deepseek-ai/dsh-tool-todo` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/todo/tool-todo/src/index.ts#L1) | 事件溯源 `todo_write` 工具 | `Tool`、`C:tools,sessionProjections` | `B+S+C+X; cfg` | `MT/MA` | Todo 归当前 Session；不是 durable task queue |
| `@deepseek-ai/dsh-schedule` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/schedule/schedule/src/index.ts#L1) | durable after/at/fixed-rate reminder 与三种管理工具 | Domain+`Tool`、`C:agents,sessions,tools,persistence` | `Opt; —` | `MT/MA` | 状态在日志；只服务未来 live root Agent，不唤醒 cold Session |

### Guard（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-repeat-tool-reminder` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/guard/repeat-tool-reminder/src/index.ts#L1) | 检测完全相同的重复工具调用并给出提示 | Policy | `B; cfg` | `MA` | advisory，不强制拒绝；只在触发时增加后缀 |
| `@deepseek-ai/dsh-tool-call-timeout-policy` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/guard/timeout-policy/src/index.ts#L1) | 用 `tools/execute` 包装 per-tool deadline | Policy、`C:tools` | `B; —` | `M0/MA` | 通过 `exec.signal` 取消；底层不响应时不能强杀任意资源 |

### Hooks（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-hooks-claude-code` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/hooks/hooks-claude-code/src/index.ts#L1) | 把 Claude Code hooks 配置桥接到 DSH interception seam | Hook、`C:sessionPersistence,shell` | `Opt; cfg` | `MA` | Hook 通过当前 Shell 执行；无事时应 no-op，外部脚本继承权限边界 |
| `@deepseek-ai/dsh-hooks-codex` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/hooks/hooks-codex/src/index.ts#L1) | 把 Codex hooks 配置桥接到 DSH interception seam | Hook、`C:sessionPersistence,shell` | `Opt; cfg` | `MA` | 同上；桥接协议而非复制另一套 Agent Loop |

### Host（7）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-host-apiproxy` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/apiproxy/src/index.ts#L1) | Host API/fetch carrier 与 `ctx.apiProxy` gateway | `D:apiProxy`、`C:projections,projectionCache,defaultModel,workspace` | `W; cfg` | `M0/UI` | 传输边界；不拥有业务事实 |
| `@deepseek-ai/dsh-host-directory-picker-auto` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/directory-picker-auto/src/index.ts#L1) | 启动时选择 native 或 browse directory picker | `Policy`、`C:webServer,loader` | `W; —` | `M0/UI` | 只做环境选择；所选 Provider 承担权限 |
| `@deepseek-ai/dsh-host-directory-picker-browse` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/directory-picker-browse/src/index.ts#L1) | 浏览器内目录列出/创建 Provider | `P:directoryPicker` | `Opt; cfg` | `M0/UI` | Host FS 边界；须限制可浏览根 |
| `@deepseek-ai/dsh-host-directory-picker-native` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/directory-picker-native/src/index.ts#L1) | 调用宿主 OS 目录选择器 | `P:directoryPicker` | `Opt; —` | `M0/UI` | 依赖桌面显示环境；无界面 Host 不适用 |
| `@deepseek-ai/dsh-host-frontend-static` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/frontend-static/src/index.ts#L1) | 安全提供 Web SPA dist 与 index fallback | Host、`C:webServer` | `Opt; cfg` | `M0/UI` | 拒绝 traversal；只负责静态资源 |
| `@deepseek-ai/dsh-host-plugin-inventory` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/plugin-inventory/src/index.ts#L1) | 只读投影当前 Cordis Loader 插件状态 | Host、`C:loader` | `W; —` | `M0/UI` | 诊断视图，不更改插件 |
| `@deepseek-ai/dsh-host-webserver` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/webserver/src/index.ts#L1) | HTTP/upgrade route、index tap 与 static fallback registry | `D:webServer` | `W; cfg` | `M0/UI` | 通用 carrier，不理解 Harness domain |

### Jobs（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-jobs-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/jobs/jobs-local/src/index.ts#L1) | owner-scoped 后台 Job 内存 registry | `P:jobs` | `B; cfg` | `M0` | 不排队；记录随进程消失，取消失效可拖住 teardown |
| `@deepseek-ai/dsh-tool-jobs` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/jobs/tool-jobs/src/index.ts#L1) | `job_output/list/kill` 模型工具 | `Tool`、`C:jobs` | `B+S+C+X; cfg` | `MT/MA` | 只能控制 exact owner 可见的 live Job |

### Skill（4）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-skill` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/skill/skill/src/index.ts#L1) | 合并多个 Skill Provider 的 registry | `D:skills` | `B; cfg` | `MP` | Catalog 进入请求前缀；Provider 集合变化会改前缀 |
| `@deepseek-ai/dsh-skill-badge` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/skill/skill-badge/src/index.ts#L1) | 提供内置 DSH badge Skill | `P:skills` | `B(disabled); —` | `MP` | 官方 Base row 默认禁用；示例/品牌用途 |
| `@deepseek-ai/dsh-skill-filesystem` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/skill/skill-filesystem/src/index.ts#L1) | 从本地目录发现 Skill | `P:skills` | `B+S+C+X; cfg` | `MP` | 目录变化会改变 catalog；完整正文按需加载 |
| `@deepseek-ai/dsh-tool-skill` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/skill/tool-skill/src/index.ts#L1) | 列出并加载完整 Skill body | `Tool`、`C:tools,skills` | `B+S+C+X; cfg` | `MT/MA` | 工具 Schema 固定；加载结果追加并保留到压缩 |

### Web 与 MCP（7）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-web` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/web/web/src/index.ts#L1) | 搜索/抓取 Provider registry 与统一错误词汇 | `D:web` | `B; cfg` | `M0` | Provider 选择与注册顺序解耦 |
| `@deepseek-ai/dsh-web-fetch-http` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/web/web-fetch-http/src/index.ts#L1) | 匿名公共 HTTP(S) 抓取 Provider | `P:web` | `Opt; cfg` | `M0` | Base 未启用 fetch，SSRF/网络策略需部署方明确处理 |
| `@deepseek-ai/dsh-web-search-deepseek` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/web/web-search-deepseek/src/index.ts#L1) | DeepSeek 原生 web_search Provider | `P:web` | `B; cfg` | `M0` | 外部模型/网络成本与凭据边界 |
| `@deepseek-ai/dsh-web-search-exa` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/web/web-search-exa/src/index.ts#L1) | Exa Search Provider | `P:web` | `Opt; cfg` | `M0` | 需外部凭据；结果质量由 Provider 决定 |
| `@deepseek-ai/dsh-web-search-perplexity` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/web/web-search-perplexity/src/index.ts#L1) | Perplexity Search Provider | `P:web` | `Opt; cfg` | `M0` | 需外部凭据；结果质量由 Provider 决定 |
| `@deepseek-ai/dsh-tool-web` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/web/tool-web/src/index.ts#L1) | `web_search/web_fetch` 模型工具 | `Tool`、`C:tools,web,systemPrompt` | `B+S+C+X; cfg` | `MT/MA` | 有界呈现；调用结果进入 Session，Provider 可替换 |
| `@deepseek-ai/dsh-mcp-client` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/mcp/mcp-client/src/index.ts#L1) | 连接 stdio/HTTP MCP server 并注册其工具 | Adapter、`P:tools` | `Opt; cfg` | `MD/MA` | server tool list/Schema 变化会破坏前缀；只桥接 Tools，不桥 Resources/Prompts |

### Subagent（10）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-subagent` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/subagent/src/index.ts#L1) | named Subagent Provider registry 与 continuation 协调 | `D:subagents` | `B; —` | `M0` | live child/activation 进程内；transport 由 Provider 决定 |
| `@deepseek-ai/dsh-subagent-acp` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/subagent-acp/src/index.ts#L1) | 通过 ACP 驱动子进程 Agent | `P:subagents`、`C:subprocess` | `Opt; cfg` | `M0` | 跨进程协议；子进程 teardown 有 grace bound |
| `@deepseek-ai/dsh-subagent-claude-code` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/subagent-claude-code/src/index.ts#L1) | 通过官方 SDK 启动一次性 Claude Code 子 Agent | `P:subagents`、`C:subprocess` | `Opt; cfg` | `M0` | 外部产品/凭据/版本边界；官方 Preset 默认禁用对应 tool row |
| `@deepseek-ai/dsh-subagent-codex` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/subagent-codex/src/index.ts#L1) | 通过 app-server 协议启动一次性 Codex 子 Agent | `P:subagents`、`C:subprocess` | `Opt; cfg` | `M0` | 外部产品边界；官方 Preset 默认禁用对应 tool row |
| `@deepseek-ai/dsh-subagent-dsh-sdk` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/subagent-dsh-sdk/src/index.ts#L1) | 通过 stdio JSON-RPC 驱动独立 DSH 子进程 | `P:subagents` | `Opt; cfg` | `M0` | 独立 Runtime；结果/取消经 SDK 协议 |
| `@deepseek-ai/dsh-subagent-fork-in-process` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/subagent-fork-in-process/src/index.ts#L1) | 从父 Session 稳定前缀 fork 子 Agent | `P:subagents` | `B; cfg` | `M0` | 子 Session 有 lineage；不能从 open Turn 边界 fork |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/subagent-spawn-in-process/src/index.ts#L1) | 在 `ctx.agents` 创建全新子 Agent | `P:subagents` | `B; cfg` | `M0` | 同进程、独立 Session；共享根基础设施 |
| `@deepseek-ai/dsh-tool-subagent` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/tool-subagent/src/index.ts#L1) | 一次性或 continuable delegation 工具 | `Tool`、`C:tools,subagents,jobs` | `B+S+C+X; cfg` | `MT/MA` | 后台收集依赖 process-local Jobs；Provider 可选 |
| `@deepseek-ai/dsh-tool-subagent-control` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/tool-subagent-control/src/index.ts#L1) | `send_message`、`interrupt_agent` 与 `list_agents` | `Tool`、`C:subagents` | `B+S+C+X; —` | `MT/MA` | 仅控制当前 continuation tree；`list-agents` 另有子路径 row |
| `@deepseek-ai/dsh-tool-subagent-report` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subagent/tool-subagent-report/src/index.ts#L1) | Child-scoped 最终报告工具 | `Tool`、`C:subagents` | `B; cfg` | `MT/MA` | 只在 child scope；交付语义由 continuation owner 决定 |

### Workflow（3）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-workflow-worker-thread` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/workflow/workflow-worker-thread/src/index.ts#L1) | 在 worker thread 运行模型编写的编排脚本 | `P:workflowEngine`、`C:subagents` | `B+S+C+X; cfg` | `M0` | 只有 foreground run；无 journal/resume，进程重启不可续 |
| `@deepseek-ai/dsh-tool-workflow` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/workflow/tool-workflow/src/index.ts#L1) | 执行 JavaScript orchestration script 的模型工具 | `Tool`、`C:workflowEngine` | `B+S+C+X; cfg` | `MT/MA` | 并发/item/agent 有 cap；无跨 children token budget |
| `@deepseek-ai/dsh-tool-ralph` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/workflow/tool-ralph/src/index.ts#L1) | 基于 fresh child Agent 的固定 Ralph loop | `Tool`、`C:workflowEngine,subagents` | `B+S+C+X; cfg` | `MT/MA` | 每轮 fresh child；默认 Preset 有有限轮数，不是无限自治 |

### Spill（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-spill-local` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/spill/spill-local/src/index.ts#L1) | 保存超大结果到私有 session-scoped 文件 | `P:spillStore` | `B; cfg` | `M0` | 本地持久文件；locator 权限与 Session 绑定 |
| `@deepseek-ai/dsh-spill-policy` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/spill/spill-policy/src/index.ts#L1) | 超阈值纯文本工具结果替换为预览与 spill 路径 | `Policy`、`C:spillStore` | `B; cfg` | `MA` | 只改变新结果展示；不替代历史 Compaction |

### Storage 与 Workspace（5）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-storage` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/storage/storage/src/index.ts#L1) | named backend 与 data-form hub | `D:storage` | `W; —` | `M0` | 非 Session 数据；后端并存并按名选择 |
| `@deepseek-ai/dsh-storage-domain` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/storage/storage-domain/src/index.ts#L1) | Schema 校验、事件化的 domain KV form | `D:storageDomain`、`C:storage` | `W; cfg` | `M0` | 持久 typed state；不是第二套 Session log |
| `@deepseek-ai/dsh-storage-json` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/storage/storage-json/src/index.ts#L1) | JSON 文件 KV backend | `P:storage` | `W; cfg` | `M0` | 单机文件持久化；适合轻量域数据 |
| `@deepseek-ai/dsh-storage-sqlite` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/storage/storage-sqlite/src/index.ts#L1) | SQLite KV backend | `P:storage` | `Opt; cfg` | `M0` | 单机事务存储；需要 schema/version 运维 |
| `@deepseek-ai/dsh-workspace` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/workspace/workspace/src/index.ts#L1) | durable Workspace entity 与 Session attachment registry | `D:workspaceRegistry`、`C:storageDomain,persistence` | `W; —` | `M0/UI` | WorkspaceId/SessionId 校验；不拥有文件系统权限 |

### Session（10）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-session-checkpoint-policy` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-checkpoint-policy/src/index.ts#L1) | 模型请求与工具副作用前执行 durability barrier | Policy、`C:llm,persistence,sessions,tools` | `B; —` | `M0` | 不确定时拒绝冒充 durable；增加关键路径 I/O |
| `@deepseek-ai/dsh-session-persistence-jsonl` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-persistence-jsonl/src/index.ts#L1) | JSONL/zstd Session 持久化与 crash-tail 恢复 | `P:sessionPersistence` | `B; cfg` | `M0` | Base 默认；`readFrom` 仍解析完整 artifact |
| `@deepseek-ai/dsh-session-persistence-sqlite` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-persistence-sqlite/src/index.ts#L1) | SQLite Session 持久化 | `P:sessionPersistence` | `Opt; cfg` | `M0` | 可物理读取 suffix；需数据库迁移/备份 |
| `@deepseek-ai/dsh-session-projection` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-projection/src/index.ts#L1) | 注册并驱动从日志折叠出的当前状态投影 | `D:sessionProjections` | `B; —` | `M0` | 投影可重建，不是第二事实源 |
| `@deepseek-ai/dsh-session-projection-cache` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-projection-cache/src/index.ts#L1) | 持久 projection checkpoint 与 tail replay 冷读 | `D:sessionProjectionCache` | `W; cfg` | `M0/UI` | write-behind + 强制 checkpoint；缓存可由事实重建 |
| `@deepseek-ai/dsh-session-stats` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-stats/src/index.ts#L1) | 会话计数与 wall-time projection | Projection Consumer | `W; —` | `M0/UI` | 全日志统计；只读投影 |
| `@deepseek-ai/dsh-session-telemetry-otel` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-telemetry-otel/src/index.ts#L1) | 将经 redaction 的 Session records 交给 OTel logs | `P:sessionTelemetry` | `B; cfg` | `M0` | Base 配置默认 disabled；数据离开进程需显式治理 |
| `@deepseek-ai/dsh-session-title` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-title/src/index.ts#L1) | 日志派生标题与唯一 async title Provider registry | `D:sessionTitle`、`C:sessionProjections` | `B; cfg` | `M0` | 标题不进入 Agent 主请求；有 deterministic fallback |
| `@deepseek-ai/dsh-session-title-all-prompts-llm` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-title-all-prompts-llm/src/index.ts#L1) | 用所有用户消息生成标题 | `P:sessionTitle` | `Opt; cfg` | `M0` | 独立模型调用；成本随用户消息集合增长 |
| `@deepseek-ai/dsh-session-title-first-prompt-llm` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-title-first-prompt-llm/src/index.ts#L1) | 用首条用户消息生成标题 | `P:sessionTitle` | `B; cfg` | `M0` | 独立模型调用；输入有界、默认 Provider |

### Session Query（3）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-session-log-export` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session-query/session-log-export/src/index.ts#L1) | Web Session 日志导出命令与下载对话框 | Command/UI | `W; —` | `M0/UI` | 导出敏感历史，权限与交付面需审计 |
| `@deepseek-ai/dsh-session-query-sqlite` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session-query/session-query-sqlite/src/index.ts#L1) | SQLite FTS5 搜索、trace 与有界读取 Provider | `P:sessionQuery`、`C:sessions,persistence` | `B; cfg` | `M0` | 索引可重建；Base `openAt` 默认不主动打开全文搜索 |
| `@deepseek-ai/dsh-tool-session-query` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/session-query/tool-session-query/src/index.ts#L1) | workspace-authorized 历史搜索/trace/event 工具 | `Tool`、`C:sessionQuery` | `Opt; cfg` | `MT/MA` | 结果有界；必须通过 workspace authority，历史按不可信数据处理 |

### Feedback（2）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-command-feedback` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/feedback/command-feedback/src/index.ts#L1) | 把 Session feedback 写日志并提供 slash command | Command、`C:commands` | `B; —` | `M0/MA` | 反馈是事实信号，不自动证明能力改进 |
| `@deepseek-ai/dsh-message-feedback` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/feedback/message-feedback/src/index.ts#L1) | assistant message rating/note sidecar | `D:messageFeedback`、`C:sessions,persistence,storageDomain` | `W; cfg` | `M0/UI` | 不进入 Session 历史或 telemetry；CAS 更新、存储于 domain state |

### Client Runtime 与 UI（33）

以下插件均为 Web Browser Cordis 面。它们把 Host facts 投影为可组合 UI，不拥有模型或 Session 事实；除特别说明外均为 `W`、无 Config、`UI`、随 Client Fiber 卸载。

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-client-connection` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/connection/src/index.ts#L1) | HTTP-up/WebSocket-down 双流与重连 | `Client`、Connection Provider | `W; cfg` | `UI/M0` | 网络瞬断重连；不成为事实源 |
| `@deepseek-ai/dsh-client-hmr` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/hmr/src/index.ts#L1) | SSE rebuilt → 预取 → Client Fiber swap | `Client`、Dev/HMR | `W; cfg` | `UI/M0` | 开发期热更；生产稳定性不依赖它 |
| `@deepseek-ai/dsh-client-locale` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/locale/src/index.ts#L1) | zh/en 偏好、fallback 与 typed dictionaries | `Client`、Locale Provider | `W; —` | `UI` | UI 文案状态；不进入模型 Prompt |
| `@deepseek-ai/dsh-client-modules` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/modules/src/index.ts#L1) | Host 扫描 `dsh.client` 并组合浏览器 entry graph | `D:clientModules`、`Client/Host` | `W; —` | `UI/M0` | Client 图变化触发重建；manifest 注入不是 Host service 依赖 |
| `@deepseek-ai/dsh-client-runtime` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/runtime/src/index.ts#L1) | SlotRegistry、SessionRuntime 与 scope/object layer | `Client Core` | `W; —` | `UI` | 浏览器 live projection；刷新可从 Host 重建 |
| `@deepseek-ai/dsh-client-ui-agent-preset` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-agent-preset/src/index.ts#L1) | 默认/当前 Agent Preset 选择与 composition editor | `Client UI` | `W; —` | `UI` | 修改只影响配置或后续 Session，活动 composition 受 Host 规则约束 |
| `@deepseek-ai/dsh-client-ui-commands` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-commands/src/index.ts#L1) | `/` command source、目录 cache 与 popup registry | `Client UI` | `W; —` | `UI` | 人类命令 UI；不直接把命令 Schema 发给模型 |
| `@deepseek-ai/dsh-client-ui-conversation` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-conversation/src/index.ts#L1) | Chat flow、composer、details host | `Client UI` | `W; —` | `UI` | 从 durable Session projection 渲染 |
| `@deepseek-ai/dsh-client-ui-deliverables` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-deliverables/src/index.ts#L1) | Produced-files turn tail 与可点击文件引用 | `Client UI`、`C:systemPrompt` | `W; —` | `UI` | 展示文件，不改变模型结果文本 |
| `@deepseek-ai/dsh-client-ui-directory-picker-browse` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-directory-picker-browse/src/index.ts#L1) | 浏览式 workspace directory flow | `Client UI` | `W; —` | `UI` | 调用 Host browse Provider；不能越过其根限制 |
| `@deepseek-ai/dsh-client-ui-directory-picker-native` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-directory-picker-native/src/index.ts#L1) | 无渲染地驱动 Host OS chooser | `Client UI` | `W; —` | `UI` | 仅 native picker 可用时工作 |
| `@deepseek-ai/dsh-client-ui-goal` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-goal/src/index.ts#L1) | Composer 上方 GoalBar | `Client UI` | `W; —` | `UI` | 读取 Goal projection，不维护第二状态 |
| `@deepseek-ai/dsh-client-ui-input-trigger` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-input-trigger/src/index.ts#L1) | `/`、`@` 检测、候选菜单与 pick routing | `Client UI` | `W; —` | `UI` | 输入辅助；最终消息仍由 Host 验证/落日志 |
| `@deepseek-ai/dsh-client-ui-jobs` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-jobs/src/index.ts#L1) | Session header 的后台 Job 列表 | `Client UI` | `W; —` | `UI` | 只镜像 live jobs frame；刷新/重启后 Job 可能不存在 |
| `@deepseek-ai/dsh-client-ui-layout` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-layout/src/index.ts#L1) | 三栏 AppFrame、drag handle 与 panel 状态 | `Client UI`、Layout Provider | `W; —` | `UI` | 纯浏览器查看状态 |
| `@deepseek-ai/dsh-client-ui-message-feedback` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-message-feedback/src/index.ts#L1) | assistant message action strip 中的反馈控件 | `Client UI` | `W; —` | `UI` | 写 Host messageFeedback sidecar，不改 Session transcript |
| `@deepseek-ai/dsh-client-ui-model-selection` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-model-selection/src/index.ts#L1) | `/model` 与 Session ModelSelection UI | `Client UI` | `W; —` | `UI` | 路由变化影响后续请求，不改已记录历史 |
| `@deepseek-ai/dsh-client-ui-permission-presets` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-permission-presets/src/index.ts#L1) | 默认与当前 Session permission preset UI | `Client UI` | `W; —` | `UI` | 写原生 permission/sandbox 事件；不绕过 Approval |
| `@deepseek-ai/dsh-client-ui-plan` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-plan/src/index.ts#L1) | Composer Plan 控制与 `/plan` 通道 | `Client UI` | `W; —` | `UI` | 通过原生 PlanMode 操作 |
| `@deepseek-ai/dsh-client-ui-settings` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-settings/src/index.ts#L1) | Settings namespace scope 与 slot contract | `Client UI Core` | `W; —` | `UI` | 浏览器组合基础，不拥有设置持久化 |
| `@deepseek-ai/dsh-client-ui-settings-general` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-settings-general/src/index.ts#L1) | General settings、onboarding 与 welcome notice | `Client UI` | `W; —` | `UI` | 产品 UI 状态；Host 决定持久化 |
| `@deepseek-ai/dsh-client-ui-settings-models` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-settings-models/src/index.ts#L1) | Model 与 Credential 设置界面 | `Client UI` | `W; —` | `UI` | 凭据只写不读；不得把 secret 回显到 Client |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-settings-plugin-inventory/src/index.ts#L1) | 只读 Loader inventory tab | `Client UI` | `W; —` | `UI` | 诊断，不拥有启停 authority |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-settings-plugins/src/index.ts#L1) | Plugins settings 与 feature-owned tabs | `Client UI` | `W; —` | `UI` | 只操作 Host 暴露的可配置插件面 |
| `@deepseek-ai/dsh-client-ui-sidebar` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-sidebar/src/index.ts#L1) | Session tree、搜索、分组与状态点 | `Client UI` | `W; —` | `UI` | Projection/listing 驱动；非持久权威 |
| `@deepseek-ai/dsh-client-ui-skill` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-skill/src/index.ts#L1) | Skill 引用与专用 tool row | `Client UI` | `W; —` | `UI` | 显示已记录 tool call/result |
| `@deepseek-ai/dsh-client-ui-subagent` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-subagent/src/index.ts#L1) | 子 Agent 会话目录、continuation routing 与 `@` source | `Client UI` | `W; —` | `UI` | 只控制 Host 授权的 continuation tree |
| `@deepseek-ai/dsh-client-ui-theme` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-theme/src/index.ts#L1) | light/dark/system 与设计 token | `Client UI`、Theme Provider | `W; —` | `UI` | DOM/浏览器偏好；不进入模型 |
| `@deepseek-ai/dsh-client-ui-tool` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-tool/src/index.ts#L1) | Tool call tree 与 keyed card presentation slot | `Client UI` | `W; —` | `UI` | presenter 从 durable args/result/meta 纯投影，不能 replay 时做 I/O |
| `@deepseek-ai/dsh-client-ui-trajectory` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-trajectory/src/index.ts#L1) | Turn/Step/Tool trajectory 与时序概览 | `Client UI` | `W; —` | `UI` | 纯 Consumer；无 service、无事实所有权 |
| `@deepseek-ai/dsh-client-ui-user-questions` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-user-questions/src/index.ts#L1) | `ask_user_question` composer takeover UI | `Client UI`、UserQuestions Provider | `W; —` | `UI` | 浏览器关闭/无 answerer 时问题不可回答 |
| `@deepseek-ai/dsh-client-ui-workflow-run` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-workflow-run/src/index.ts#L1) | durable Workflow Conversation Node 与成员展开 | `Client UI` | `W; —` | `UI` | 只重放已记录 run presentation；不让 workflow 可恢复 |
| `@deepseek-ai/dsh-client-ui-workspace` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-workspace/src/index.ts#L1) | Sidebar/empty-state Workspace picker | `Client UI` | `W; —` | `UI` | 通过 Host Workspace/DirectoryPicker，不能自行访问磁盘 |

### Dynamic Cordis Extensions（4）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-cordis-host-runner` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/extensions/cordis-host-runner/src/index.ts#L1) | 内存 definition registry、Host VM 与 browser invoke table | `D:dynamicCordisRunner,cordisInspect` | `W; cfg` | `MD` | 定义进程内；VM 不是安全边界，async body 可逃出同步 timeout |
| `@deepseek-ai/dsh-cordis-client-runner` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/extensions/cordis-client-runner/src/index.ts#L1) | 动态 browser half 的订阅、guard 与 Loader entry | `Client`、Dynamic Provider | `W; —` | `UI/MD` | 页面刷新需 Host 重投；定义不持久 |
| `@deepseek-ai/dsh-tool-cordis` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/extensions/tool-cordis/src/index.ts#L1) | inspect/define/run/stop/undefine 自引用工具集 | `Tool`、`C:tools,dynamicCordisRunner,cordisInspect` | `X; —` | `MD/MA` | 等价 Bash 信任；不写文件、不安装、不自动晋升、重启即失 |
| `@deepseek-ai/dsh-client-ui-cordis` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/extensions/ui-cordis/src/index.ts#L1) | `cordis_define` 卡片与 run/stop 开关 | `Client UI` | `W; —` | `UI` | 仅呈现/控制当前 Session 所属内存 package |

### E2B POC（3）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-e2b` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/e2b/e2b/src/index.ts#L1) | 共享 E2B sandbox handle、远端 cwd 与销毁策略 | `D:e2b` | `Opt; cfg` | `M0` | 仓库明确标为 POC；依赖付费/网络服务 |
| `@deepseek-ai/dsh-fs-e2b` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/e2b/fs-e2b/src/index.ts#L1) | E2B 文件系统 Provider | `P:fs`、`C:e2b` | `Opt; —` | `M0` | 必须与同一远端 execution world 的 Subprocess 配套 |
| `@deepseek-ai/dsh-subprocess-e2b` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/e2b/subprocess-e2b/src/index.ts#L1) | E2B Subprocess Provider | `P:subprocess`、`C:e2b` | `Opt; cfg` | `M0` | 远端资源生命周期由 E2B owner 统一收束 |

### SDK（1）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-sdk-jsonrpc-server` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/sdk/server/src/index.ts#L1) | 为外部 TypeScript/Python SDK 提供 stdio JSON-RPC server | `Gateway` | `Opt; cfg` | `M0` | 协议/进程边界；业务状态仍归 DSH Service |

### Example 与 Test Support（3，非产品插件）

| 包 | 源码 | 作用 | 角色 / Context | 装载 | 模型/KV | 状态与边界 |
|---|---|---|---|---|---|---|
| `@deepseek-ai/dsh-acp-demo` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/examples/acp-demo/src/index.ts#L1) | Agent spine + JSONL + ACP 的可运行自动化示例 | `Example Bundle` | `Opt; cfg` | `组合决定` | 示例基础设施，兼容预期低于产品插件 |
| `@deepseek-ai/dsh-agent-spine-demo` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/examples/agent-spine-demo/src/index.ts#L1) | 无 UI/Executor 的默认 Agent spine 示例 | `Example Bundle`、`C:agentLoop` | `Opt; cfg` | `组合决定` | 展示 fallback title、retry 与可选 Goal，不是新 Runtime |
| `@deepseek-ai/dsh-llm-replay` | [src](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/test-support/llm-replay/src/index.ts#L1) | 从记录 JSONL 重建 model chunks，短路 `llm/stream` | `P:llm`、Test | `Opt; cfg` | `M0` | 仅 keyless snapshot/replay 测试，不应用于生产推理 |

## 4. 可机器复核的数量规则

本文每个可加载插件恰有一行，且插件数据行统一以 ``| `@deepseek-ai/dsh-`` 开头。复核命令：

```bash
rg -c '^\| `@deepseek-ai/dsh-' docs/research/deepseek-harness-native-plugins.zh.md
# 171
```

还应验证唯一性：

```bash
rg '^\| `@deepseek-ai/dsh-' docs/research/deepseek-harness-native-plugins.zh.md \
  | sed -E 's/^\| `([^`]+)`.*/\1/' \
  | sort | uniq -d
# 无输出
```

仓库侧的交叉验证规则是：遍历 `packages/*/*/src/index.ts`，按 Cordis Loader 的 `unwrapExports` 语义识别本文件 default、导出的 `apply`，并额外跟随 `export { default } from ...`；剔除 15 个 abstract Service Definition 与 33 个无插件 entry 的 library。该规则得到 171，并解释了官方 Config Catalog 当前少算 `dsh-typert-registry` 的原因。

## 5. 使用目录时的边界

- “原生存在”不等于“默认启用”；应以 `dsh --profile <name> --dump-config` 检查真实组合。
- “可加载”不等于“产品稳定”；E2B 是 POC，example/test-support 明确不属于 168 个产品插件。
- Definition、Provider、Consumer 是职责，不是互斥包类型；registry 型插件可以同时拥有 Definition 与运行服务。
- 工具插件通常改变固定 Tool Schema；Provider 通常无直接模型可见影响；Context、Persona、Compaction、MCP 和动态 Cordis 是 KV Cache 审计重点。
- Process-local Job、Workflow run、Goal activation、Schedule timer 和 Dynamic Cordis definition 不能被误读为跨进程 durable 能力。
