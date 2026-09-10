# DSH 原生插件契约

本文是 EvoForge 包级实现的当前最低要求。具体 DSH API 必须以每轮开发前审计的上游 revision 为准，不能从旧
evidence 或历史源码链接推断。当前版本身份见 [DSH 最新审计](research/dsh-latest-audit-2026-09-05.zh.md)。

## 1. 交付形态

每个运行组件必须是可由 DSH 官方 Loader 安装的 out-of-tree Cordis Bundle；需要浏览器时，通过 DSH Client
metadata 注册模块。包必须提供：

- `package.json` 中明确的 name、version、license、repository、exports、files 和 peerDependencies；
- 根级 `cordis.patch.yml`，只插入本包拥有的稳定 row；
- Host 入口 `default export Service`；Client 包提供 DSH 认可的 client metadata；
- 不发布额外 Agent executable、第二 Host、第二 Web server 或隐式安装器。

能力套件只把多个真实 Bundle 编排成一个用户结果，不是 Meta Runtime。默认产品和兼容入口见
[能力套件](capability-suites.zh.md)。

## 2. DSH 权威

插件不得复制或替代 DSH 的 Agent、Session、Goal、Skill、Tool、Approval、Jobs、Schedule、Workspace、Credential、
Storage 或生命周期。确需状态时，使用 DSH Storage 提供的 namespaced domain，并保留清晰的 owner、scope、schema、
恢复和卸载语义。

跨包依赖通过 Cordis Service Definition/inject 表达，不能靠全局变量、固定启动顺序、端口探测或扫描其他包的
私有目录。可选 Provider 出现/消失时，Consumer 必须正确 activate/dispose。

### 2.1 Interaction Generation 证据保留策略

`dsh-evolve.interactionEvidencePolicies` 是 Host 管理员对 raw-free Generation receipt 的逐 Workspace 保留授权，默认
为空（不写入且不返回 positive match）。它不是用户同意、DSH Episode/Session 读取权限，也不能扩大 Tool、Skill、
Provider 或 Workspace 权限。它只开始为未来的可信 Host evidence composer 保留私有历史账本；当前插件不会自动消费该账本，
也不会自动闭合任何运行时 Episode evidence dimension。每项只接受一个 canonical 小写 native Workspace UUID v1-v5，
最多 100 个 Workspace；
`retention.generationMaxRecords` 必须是 `1..10000` 的整数，所有配置项之和不得超过 100000，durable vault 的物理记录
数也不得超过 100000。

配置撤回后必须立即拒绝该 Workspace 的新写入和 positive read，但不会自动清除已经持久化的记录；删除、导出和用户同意
仍由各自的 Host 策略处理。逐 Workspace quota 只按 Host 持久化的单调写入序号裁剪 `resolved` 行，不使用事件自身的
`observedAt`，也不影响其他 Workspace。receipt 的 subject identity/key 不包含 Workspace；同一 subject 的矛盾 Workspace
声明因此会生成带排序 `workspaceIds` owner 元数据的全局 conflict tombstone。tombstone 永不因 quota 或 aggregate cap 被
裁剪；跨配置轮换累计到第 101 个历史 owner 时，live vault 会整体 fail closed，而不会丢弃 owner 元数据。超过 aggregate
cap 时 vault 在打开或新写入处 fail closed，不通过删除 tombstone 腾挪容量。

冲突转换必须先写完整 tombstone；若写入报错，只在立即 readback 得到完全相同的 tombstone 时才视为已提交，否则当前
vault authority 整体 unavailable，并由 `drain`/`close` 暴露失败。后端明确拒绝且未提交的矛盾观察不属于 durable
accepted evidence；重启只能恢复此前真正持久化的状态，不能宣称存储从未接受的数据已跨重启封存。

### 2.2 Interaction Routing 证据保留策略

`dsh-evolve.interactionRoutingEvidencePolicies` 是与 Generation 完全独立的 raw-free Routing receipt 保留授权，默认
为空。每项只接受 canonical 小写 native Workspace UUID v1-v5；`retention.routingMaxRecords` 必须是 `1..10000` 的整数，
最多 100 项、配置总和及 vault 物理记录上限均为 100000。配置撤回只停止新写入与 positive read，不自动清除历史行。
该策略不是用户同意、Session/Episode 读取权限、Gap 写入权限或自动 authoring 权限；不得借 Generation 策略隐式授权
Routing，反之亦然。Goal-linked Gap 的 authoring qualification 是完成 turn 后写入独立、审计型 sidecar Domain 的另一份
无原文标记；legacy Gap v1 行保持原样，读取时才合并 projection。qualification v2 以内容寻址 id 和完整 Gap 内容 digest
绑定 exact gapId、Workspace、Session、requested Skill 与 Goal id/revision；它无条件服从自身证据合同，不由可选 Routing
vault 的配置、成功或失败授予或撤回。新 qualification 才触发一次即时 reconcile；vault 失败不能把已证明的 Gap 变成
未授权，重启扫描也只能消费通过 key/id/content/reference/binding 审计的 qualification。

v1 只允许 EvoForge 自有 `report_capability_gap` Tool 的成功直接调用形成 Routing receipt。Producer 必须同时证明：

- exact live Agent/Session 从 `agent/session-start` 起的连续物理事件；
- 该 turn 每次 admission 的 exact owned Tool registration，且所有已落盘 request header 都包含固定、唯一、相同的
  model-visible schema；
- registry-minted root Tool execution、实际进入并完成的自有 body、body 写入的 model-declared Gap、最终冻结的
  `tools/result` success，以及 DSH Session 中与 call event 精确相连的 durable result；
- turn 以 `completed` 结束，read-only transcript projector 能证明唯一 direct Gap trigger、请求边界和因果顺序。

任何 shadowed same-name Tool、重复 execution/call/result、post-execute 改写、取消、异常、事件乱序、生命周期冒充、
schema 漂移、Tools unmount/HMR 跨 epoch 或 Workspace 漂移都不能产生 positive receipt；已有 subject 出现确定矛盾时写入
sticky conflict tombstone。Tools 单独 remount 不要求伪造新的 Session start，但会使旧 registration 下所有未决观察失效；
后续完整发生在新 registration epoch 的干净 turn 才可重新取证。

这里的“实际进入自有 body”是 Producer 对 exact registry execution 与 body entry/settlement 的观察，不是 alpha.5 dispatcher
提供的定义选择证明。当前固定版本既不暴露 dispatcher-selected `ToolDefinition`，也不暴露其内部 `bodyInvoked` 状态，因此
不能承诺排除所有 captured-body 路径：若下游 `tools/execute` wrapper 在 registry 未发生 mutation/shadow 时，用同一个
registry-minted execution 调用 captured official body、跳过 `next()` 并返回完全匹配的 success，Producer 会接受该边界。
任何 registry mutation 或 same-name shadow 仍按上述规则使观察失效。

Tool body 为了返回稳定 Gap id 可以先持久化 model-declared 行，但该行在 authoring 上仍是 provisional：只有上述 exact
final result、durable Session result、Workspace 复核和 completed turn 全部成立后，Producer 才用同一 raw-free receipt 的
subject/provenance 写入 `completed-owned-gap-turn-v2` qualification。sidecar 写入前必须 exact-match durable Gap；不同 Gap 之间
不能转移 qualification，重启时任何 orphan、key/id/content 或 binding 漂移都会使该 authority fail closed。pipeline 外直接
调用或伪造 execution 的 captured body、
取消、post-execute 改写、blocked turn 和历史上没有 qualification 的 model-declared 行保持可读但不能进入 opportunity、
evaluation seal 或重启 reconcile。

普通 native `skill` Tool 的 error 不能证明 Skill 缺失：它也可能来自 policy、加载、取消或执行错误。因此该路径不再生成
新 Gap，也不能进入 opportunity/evaluation 治理；旧 `native-skill-miss` 行只为 schema/readback 兼容保留。Routing fact
只闭合 Episode 的 `routing` 维度，Workspace 仅用于与其他 Host source 交叉校验；它不证明 catalog winner、
capability boundary、Generation、模型、权限、sandbox 或其他 composition。当前运行时只保留私有历史账本，不会自动
消费 source 或创建完整 Episode。

Routing vault 复用 2.1 的 subject-only identity、按 Host 单调写入序号裁剪 resolved 行、跨 Workspace owner 合并、
sticky tombstone、冲突写入 readback、配置撤回和 fail-closed 规则，但使用独立 Domain、策略、quota 和 authority。
普通用户输入不能直接制造 tombstone；它只来自已安装 Host composition 内的权威矛盾。tombstone 不因 Workspace
resolved quota 被删除，最终仍受 100000 物理记录安全上限约束。

Host composer 对 Gateway、Generation、Routing 每个 source 使用独立的 30 秒上限；超时只会产生
`attestor-invocation-failed` abstention，迟到的成功或失败不得改变结果。DSH alpha.5 的 Storage Domain/KV mutation 与
`close` 尚无 AbortSignal、deadline 或 no-late-write fence，因此已接收但永不 settle 的 durable write 还不能由插件同时做到
有界退出和物理释放。当前实现选择等待真实 settlement，而不是伪报 cleanup 完成；该上游 seam 是发布前必须关闭的生命周期
阻断。

## 3. 生命周期

所有 listener、timer、watcher、transport、Remote、临时目录和文件句柄都由当前 fiber 持有。disable、reload、
dispose 或 remove 后必须：

1. 停止接收新工作；
2. 有界 drain 已接收工作或明确标记 uncertain；
3. 取消订阅并释放资源；
4. 不再写状态、发消息或更新 UI；
5. 不删除 DSH 原生数据，也不宣称撤回已发生的外部效果。

异步启动和卸载并发必须可重复测试；后台 Promise 不能在 dispose 后产生未捕获 rejection。

## 4. 模型与 KV Cache

每个包要声明自己是否增加 Tool、Skill、System Prompt、Session event 或模型调用。只读 Host/Web/诊断组件应保持
零模型调用和零模型可见 token。需要模型可见内容时：

- 只通过 DSH 原生 Session/Skill/Tool seam；
- 固定 schema 和稳定前缀，不把时间戳、随机 id 或动态健康状态写进 system prompt；
- 记录 cache-read、uncached input/output、延迟和组成差异；
- 卸载后模型组成恢复，不能残留 Tool/Skill/Prompt。

## 5. 权限、凭据与外部效果

凭据只保存和解析于 DSH CredentialProvider；配置中只允许引用名。不得把 Secret 放进 profile YAML、Git、日志、
Session、Web projection 或 evidence。

代码修改、profile 写入、OS service、付费 Provider 和外部发送属于 Protected Action。由 Agent 发起时服从 DSH
Tool policy/Approval；人在 shell 中直接执行属于部署者权限，不能伪称经过 Agent Approval。外部效果必须先写
durable intent，使用确定性 identity；结果未知时保留 uncertain，不能盲目重试。

## 6. Web

EvoForge 只注册一个 Session-scoped 原生 `conversation.view`。Control Center 提供 child slot，各业务包贡献自己的
Host-authoritative projection。Client 不保存第二份真相、不直接写 Generation、不显示 Secret/正文/私有路径，必须
实现 loading、empty、stale、error、retry 和权限拒绝状态。空 Session/onboarding 不渲染 slot 是 DSH 边界，不能用
固定浮层或第二网页绕过。

## 7. 安装、更新与卸载

公开 registry 尚未发布时，只允许使用仓库安装器生成并校验的 exact tarball。DSH 对本地 `file:` 依赖会持续引用
原路径，因此产物必须先进入持久内容地址，不能安装后删除。安装器不得回显 effective config。

每个可发布组合必须从 clean profile 验证：

```text
add → list/dump → boot → real Session path → reload/dispose → remove → boot/readback
```

验证还要覆盖部分安装失败、重复安装、缺失凭据、Host 重启、依赖消失和卸载顺序。通过 unit test 或生成 tarball
本身不等于完成原生插件合同。
