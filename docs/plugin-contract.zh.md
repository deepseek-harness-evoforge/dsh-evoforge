# DSH 原生插件契约

本文是 EvoForge 包级实现的当前最低要求。具体 DSH API 必须以每轮开发前审计的上游 revision 为准，不能从旧
evidence 或历史源码链接推断。当前代码固定使用 DSH `0.1.6-alpha.1` / `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`；
原生初始化使用 awaited `agent/created`，Typert 由同 revision 官方生成器生成。历史 alpha.5 部署不会自动升级，
也不能加载这组新包。上游身份见 [DSH 最新审计](research/dsh-latest-audit-2026-09-15.zh.md)；其旧支持基线说明仅适用于该审计时点。

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

Transcript 与 request-control reader 只接受两个显式 cohort：Session format v0 对应已审计 alpha.5 dialect，format v3
对应 rc.2 reader semantics。v3 当前只证明 human-first、没有预排 `next-step` inject/steering context 的 settled direct turn；
必须使用 embedded compact Assistant stream，逐条验证 record/chunk grammar，并令重新 assembly 的 content、usage、replay
state、显式成功 finish 与 durable message 完全一致。raw Tool-call delta 可以先携带 current adapter 合法的空 identity，但
最终 closing block 与 durable message 的 id/name 必须非空且完全一致。System prompt 只接受 AgentLoop 当前固定 source
`{kind: plugin, plugin: @deepseek-ai/dsh-system-prompt}` 的 empty/单 text `system/message` 投影；
首个 surface 必须是请求输入之前建立的受保护 System head；本 cohort 的后续非空 append 只能出现在继承 request header
的后续 step 请求输入之前，不能重复当前有效 prompt；tail 存活后每个后续请求都必须继续继承 header 且保持 effective
`systemPromptUpdate: in-history`，否则在 replacement 支持迁入前 abstain。
`request/header.system` 必须缺席，request context 只额外接受并绑定 `systemPromptUpdate: in-history`。

reader 会扫描从 Session 开头到目标 `turn/end` 的整个前缀：未知 required 事件、`assistant/attempt`、`llm/retry*`、surface
replacement、`compaction/*`、PTC dispatch、顶层 legacy chunk/citation、compact stream 未知字段或 mixed dialect 都
abstain；只有明确带 `ignorable: true` 的未知事件可跳过。`sourceDialect` 与 logged-control digest 都参与 receipt identity，
后者还随 raw-free Generation/Routing fact 到 Host composer 做 exact match。旧的 digest-less receipt/qualification 行仍可读取和
审计，但不能命中 current query，也不能授予 authoring/evaluation 权威；这些字段表示 reader semantics 与已记录 control，
不证明历史运行时 revision，也不把这个窄 cohort 升级为完整 rc.2 支持声明。

物理 Session cut reader 必须 exact XOR 选择 alpha.5 `readFrom` 或 current `open` capability，不能猜测或同时调用。
current 路径只取得 read handle，按已冻结事件数执行有界 `read`，验证 result envelope，并在成功、失败、timeout 和 dispose
路径 exactly-once `close`。同一个 Cordis-owned 30 秒 deadline 覆盖 capability 选择与 read/open/close；deadline 发布前先
同步 abort，迟到 handle 只能关闭、不能开始迟到 read。read 成功后的 close error 是 invocation failure，不能伪装成
NotFound/unsupported/corruption 结论。两个已审计 codec 把 header 中缺席的 `delegationDepth` 物理化为 `0`；
verifier 只对 v0/v3 的这一默认值做 equality normalization，随后仍把捕获的 logical header 用于 transcript 与 receipt
identity，其他 header 差异全部 conflict。这个 deadline 不包含此前的 `sessions.flush()`，因此不得声称整个 resolver
end-to-end bounded。

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

### 2.3 普通聊天纠正识别策略

`dsh-evolve.conversationCorrectionPolicies` 默认空。每项绑定一个 canonical native Workspace UUID，显式指定
`maxAttemptsPerUtcDay`（1–20）；最多 20 个 Workspace。它只授权该 Workspace 的有限原生模型识别调用，
不授权工具执行、文件修改、Candidate authoring、评测或晋升，也不会写入/冒充原生 `messageFeedback`。
识别在 completed turn 后的原生 Jobs 中进行，不在用户请求之前分类或选路，不修改当前 Session 的模型组成和历史。
创建 Job 前及开始检查前，按已持久化的草稿评测计划排除精确匹配的原生评测 Session；启动回读同样排除。
该归属检查不依赖名称前缀或当前评测策略，历史计划在策略撤回后仍有效。归属不可读取时停止检查并显示警告，
不把评测输出当成用户纠正；其他来源读取错误仍按失败报告，不隐藏真实故障。
模型仅通过当前 DSH LLM 服务及来源 turn 已记录的 provider/model route 调用；不引入 API Key 环境变量或另一模型服务。

来源只选 v3 持久化前缀中明确的前后完整 turn、各自唯一的直接 user 消息与最后 assistant 文本，并绑定 exact seq、
前缀/输入/模型 route digest。中间合成上下文不会被当作用户纠正；文本上限为 JSON-framed 24,000 字节，不截断后伪称完整。
模型输出必须落在固定分类枚举内；声称纠正时必须给出当前 user 文本中的 8–256 字符原句，持久化仅保留其 digest。
这只是 unverified Correction Hypothesis，不是完成效果、Skill 因果归因、独立样本或完整 replay/composition 证明。
当前不会将这些记录送入旧的 Goal-qualified Candidate 管线；独立授权的草稿阶段见 2.4。

可选 `replaySessionIds` 最多 10 项，显式授权启动时检查各指定 Session 的最后两个 completed turn；除此之外不扫描历史。
所有会话共用该 Workspace 的每日预留计数；单次输出上限 800 token、模型 deadline 60 秒。预留和 dispatch marker 在模型
调用前持久化；相同来源幂等。崩溃遗留 reserved/dispatching 或未知请求结果变为 uncertain，不在重启后自动重发。
预算按 UTC 日计，包含保守保留的中断预留；它不是货币价格承诺。实际 token 用量可用时才记录，缺失标记 unknown。

所有 raw-free 记录位于独立 native Storage Domain，使用整体校验布局；总计最多 10,000 行，满时停止采集，不通过删除历史
规避幂等或预算。存储失败使该账本停止新请求；卸载/策略撤回取消并等待自有工作，不清除原始 Session 或既有记录。
Job 标签与结果不携带原文、路径或 provider 错误，模型结果不直接显示为“已学会”。原生控制面分别显示回答负反馈、
聊天纠正线索、识别中、结果不明和预算耗尽。该状态不能代替独立评测与后续未见任务效果验证。

### 2.4 普通纠正的隔离 Skill 草稿

`conversationLearningPolicies` 默认空，每项接受 canonical Workspace UUID 与 `maxModelCallsPerUtcDay`（至少2的安全整数），
最多 20 个 Workspace；须存在该 Workspace 的纠正识别策略，或配置下述明确反馈 Session。它不接受操作者指定的 Skill、
测试包或晋升开关。原生 Jobs 启动时及纠正识别 Job 完成后，从已保存线索选择纠正链的末端，物理重读并 exact-match 来源后才处理。
来源是未验证模型解释，不会变成已验证用户反馈、独立样本或既有 Skill 归因。

起草每个角色调用前后再次物理回读并核对来源前缀、原始输入、纠正记录和 Workspace；评测在模型发送前、
分支结束后及提交比较结论前执行同样复核。读取失败、来源变化或撤回策略时不继续调用、不提交新的草稿/比较结论；
已经记录的预留、dispatch marker、分支结果与已知用量保留，未知消耗不按零。复核是原生读取，不新增识别模型请求。
这不撤销已经完成的历史实验；消息反馈使用下述独立来源，不冒充聊天识别结果。

可选 `explicitFeedbackSessionIds` 默认空，最多十个不重复的原生 Session id。管理员只允许这些 Session 的当前带说明负反馈
参与同一个草稿预算，既不扩大日预算，也不需要先支付一次模型调用来把明确反馈再识别为纠正。
只读启动回读和原生 `session/event`、`feedback/committed` 触发覆盖这些确切 Session，不扫描其他历史。
冷提交观察器不等待同 Session 的反馈操作；工作交给原生 Job 后先加入 `messageFeedback.list` 队列，再核对实际持久化前缀。
配置包含该来源时，监控器显式依赖原生 messageFeedback 服务；依赖消失或配置撤回会取消并等待自有工作。
按已保存评测计划排除精确的评测 Session，归属不可读取时停止，不能把测试材料交回 proposer。

消息反馈来源只接受至多 20000 事件的完整 v3 前缀、非继承的唯一直接文本 user、对应 completed turn 的最后 append assistant，
以及在完成后保存、当前仍匹配的负反馈 note。替换 surface、compaction、附件型 user、歧义目标、未完成 turn、
空说明或合计超过 JSON-framed 24000 字节的文本不进入草稿。来源绑定 messageId、反馈版本、反馈事件、原生 seq、
前缀/文本/模型 digest；没有虚构第二个对话 turn、分类调用、已验证解释或 Skill 因果归因。

同一回答的反馈修改、删除后重建或跨 UTC 日不会制造新起草身份；聊天纠正与明确反馈引用同一回答时，不重复起草。
新记录用可选 `messageFeedbackSource`、`sourceAnswerSeq` 保留来源，原 `correctionId` 对新来源仅是稳定来源 hash，
不指向或伪造 CorrectionLedger 行。旧记录保留原样，旧记录的回答身份可从其真实纠正账本复核。
两个角色及评测共用一个来源解析器，每次检查都重读当前 native feedback 和物理日志；修改、转为正面或撤回后不得继续
生成草稿或启动/提交新的比较。已消费的尝试、用量和历史结果不删除，也不把编辑当作新独立样本。
可通过撤回该来源配置停用并保留历史；新增来源元数据不保证能由旧二进制严格 schema 读取，不自动降级程序或覆盖账本。

默认协议在调用前持久预留两个预算槽：第一个原生 LLM 请求生成四个隔离测试材料（两个 holdout、两个 retention），
通过结构、唯一性及正反例断言校验后封存。新材料还必须提供 `alternateAnswer`：在任务允许时使用不同表达但保留事实与
指定格式的另一正确答案，唯一指定输出可以相同。两个正例均须通过固定字面断言，负例须失败；不合格时在 proposer 前停止，
不改写断言或自动重抽题。第二个独立请求只收到原纠正上下文，不能收到测试题、参考答案、替代答案或评分反馈。
两者复用来源的原生 provider/model，均无 Tools 和 Agent Loop 标记；输出上限分别 4000/2000 token。

可选 `testPreparation: staged-v1` 将准备工作分开，策略需容纳九次请求：按固定 h1/h2/r1/r2 顺序分别生成任务与参考答案，
先持久保存四份原始材料，再对各份材料请求替代正例、负例与断言，最后才调用同一个隔离 proposer。
每次发送前独立保存调用标记，成功后只追加固定步骤；校准只能读取相应任务和参考答案，不能修改它们。
部分结果保存在原草稿 Domain，不另建执行器或状态库；完整输入 digest 绑定该准备协议的静态提示与分区。
任何重复题、来源复制、非法材料或校准失败均终止，不自动改题或重抽。完整四题仍通过相同结构及正反例校准，
也仍须独立语义/实际效果验证；分步骤成功不是学习成功，不扩大现有文本评测的适用范围。
提出者只收到原纠正，不收到任何步骤、题目、答案、断言或评测反馈。默认旧协议和历史记录不改写。

可选 `testPreparation: file-records-v1` 专用于记录核对类文件工作流，由 Host 固定协议生成四份文件任务与类型化 JSON
期望，不调用模型出题或裁判。原始来源 digest 决定种子；协议、顺序、文件内容及答案在唯一的 proposer 请求前封存，
输入 digest 绑定协议 hash。h1 为客服工单的原始行/实体/最新状态与比例分母，h2 为跨场次报名、最新状态与零分；
r1 保留明确不去重的逐行金额，r2 保留无关的审批与承诺约束。数据为合成的真实工具工作流输入，不冒充用户数据或广泛基准。
提出者仍只收到原纠正、没有 Tools；不能读取任务、输入文件、答案或评分实现。此协议预留一次起草请求，默认策略不改变。

`upgradeFailedPreparations: [{ draftId, expiresAt }]` 仅能精确指定旧协议 `abstained/invalid-governance`、尚无完整治理材料、
尚未调用提出者的终态；默认空，至多十项，过期时间不得超过加载时24小时。新记录通过 `preparationUpgradeOf` 和旧
input digest 绑定原尝试，同一物理来源必须仍有效。它是明确的治理协议替换，不是自动重试或重评分；不覆盖旧失败、
不回收旧消耗，不接受成功草稿、已封存实验或事后改答案。并发和重启不能生成第二个替换子记录。
file-records-v1 的提出者传输失败可按原精确重试授权继续，但必须保留完全相同的文件治理计划；不自动连重试。

每次请求由 DSH 原生适配器判断传输活性，插件不以“没有模型内容片段”覆盖适配器对 SSE 心跳的判断；
原生 `deadline` 限制总时长600秒，信号传播至同一个原生流，并等待 iterator 清理；
对不响应取消的 provider 不承诺物理释放时限，不用脱离后台工作的 Promise race 冒充结束。
新请求记录角色、总耗时、首个模型片段等待时间及片段数，不保存流正文或凭据；传输细节未知时不推断服务端是否停滞。
总时限失败记录 `model-total-timeout`；旧 `model-timeout`、`model-idle-timeout` 和180秒总超时保持历史含义、不重分类。
失败保留调用/预留和已知用量、冷恢复不自动重发；旧程序不保证能读取新增时序字段，不覆盖账本降级。
测试作者本身也是模型；此校验不是基线效果、泛化或事实正确性证明，更不是独立评测成功。

输出是私有 Conversation Skill Draft，不是具备资格的 Evolution Candidate。名称、描述和单个自包含 `SKILL.md` 内容
由模型提出，Host 固定元数据和内容 digest；起草阶段不存在脚本文件、安装、Skill provider 注册、Generation 选择或晋升入口。
当前 Session 组成与历史不变。旧 Goal-qualified Candidate 资格和发布门禁不接受草稿记录。

草稿和封存测试材料存于独立 native Domain，总计最多 100 条，达到上限停止。来源只保留 identity/digest；模型生成
内容仍可能反映来源语义，因此整份 Domain 是私有内容，不能称为 raw-free。Web 可显示本 Workspace 的最后五份草稿，
不返回测试输入、参考答案或负例；正文以转义文本呈现。准备中、未成稿/不确定、草稿未启用和预算分别显示。

预留/dispatch marker 都先持久化；相同来源幂等，崩溃遗留未决状态变 uncertain，跨 UTC 日也不自动重发。
管理员可用 `retryFailedDrafts: [{ draftId, expiresAt }]` 对指定失败记录授权一次新的诊断尝试；默认缺省，最多十项，
`expiresAt` 为 Unix 毫秒且加载时不得晚于当前时间 24 小时。过期授权不执行，实际预留时再次检查有效期和共享日预算。
旧协议仅接受尚未封存测试材料、最多 dispatch 一次且结果 uncertain 的传输失败记录；不能重跑已封存材料、无效材料或成功草稿。
staged-v1 的传输失败可继承已经成功保存的完整步骤前缀，只执行缺失请求；校准不能重抽任务，提出者失败不能重抽评测材料。
新记录用确定性的 `retryOf` 绑定直接父记录，逐字核对继承前缀；原记录不覆盖，旧预留不退还，新预留只包含缺失步骤及提出者。
九步均未完成时最多预留九次；仅缺提出者时预留一次。请求时序带本次尝试内的序号，旧时序记录保持原样。
新增准备步骤和序号不保证旧二进制可读；能力回滚不能通过覆盖账本或降级读取器完成。
明确指定的旧协议早期失败可转入 staged-v1，新记录额外绑定父记录原 input digest；来源必须完全一致，不能借协议升级改变纠正或覆盖旧结果。
启动校验完整父子关系、固定分区、步骤及累计进度；并发、重启、换 UTC 日或保留同一授权都不能重复创建子尝试。子尝试再次传输失败时，
必须显式指定该子记录才能继续，不能沿用根授权自动连重试。重试仍不是新的独立纠正样本，失败链完整保留。
撤回授权只阻止新尝试；如需取消已 dispatch 的工作，应撤回整个草稿策略以触发原生生命周期取消，不能撤回既有消耗。
策略撤回取消并等待自有工作，不清除历史或存储记录；存储错误 fail closed。草稿及测试内容仍需独立效果和安全检查，
草稿本身没有 activation、release 或 rollback 权威；后续人工确认门禁见 2.6，不能以“没启用所以无需回滚”为完整学习链路验收。

### 2.5 普通草稿的有限原生对照检查

`conversationDraftTrialPolicies` 默认空；每项绑定 canonical Workspace UUID 与 `maxModelCallsPerUtcDay`（至少24的安全整数），
最多 20 项，且必须存在相同 Workspace 的草稿策略。它不接受操作者指定的测试包、Skill、参考答案或晋升开关。
可选 `semanticEvaluation` 默认 false；开启时同一日预算必须至少 44。它只影响尚无实验的新草稿，不能重评历史实验。
原生 Jobs 在启动及草稿完成后，按来源时间检查未试验的草稿；重读来源会话前缀、纠正记录与草稿 hash，匹配后才预留。

一份草稿只建立一组固定实验，跨日和重启不自动重新运行。默认字面模式一次预留 24 个调用名额：四个已封存任务各创建 baseline/draft
两个原生 Session，共八个分支，每分支最多三次请求、每次最多 2000 输出 token、90 秒取消通知；按任务交替先后顺序。
预留前检查替代表达校准；缺失或失败的材料写入 `blocked/evaluator-unqualified` 终态，预留为零，不建立原生执行 Session，
不接受初始化恢复授权。历史材料可读，已记录实验不重评、不重跑。该校准仅验证有限正反例自洽，不证明语义正确性；
控制面得分明确标为字面断言通过数，不能解释成任务完成率。
baseline 与 draft 使用相同来源 provider/model、cwd 和工具限制；只有 draft 分支在新 Agent 的 scoped Skill registry 中
挂载草稿。正文只能通过原生 `skill` Tool 按需加载；禁止其他工具和额外辅助模型请求，不改变当前 Session 或全局 Skill。
程序化 Agent 不假定继承用户 preset：若没有可见 `skill`，在该 Agent 内挂载官方 `dsh-tool-skill`，卸载随 handle 释放。
已有读取工具时不重复挂载目录监听器；全局工具限制只引用全局名称，局部读取工具不被误列为全局白名单。
原生 Agent 的请求信号、精确 Session id、输入与已持久化 marker 用于关联最终请求；不依赖跨模块实例不共享的 WeakSet 标记。
测试 Agent 不自动重试。取消后等待原生 handle dispose；不声称能为不响应 abort 的上游提供物理释放时限。

执行方只收到任务，不收到参考答案、负例或断言；字面模式在 Host 侧执行已封存的确定性检查。必须同时验证 completed turn、
无工具错误、实际 Skill 加载，以及四组完整首请求的组成相同（只排除会话/消息标识和已校验的草稿目录项）。未知目录格式、
系统提示/工具/参数/任务漂移均不可比。检查通过数、改善/退步数、可比组数、Skill 加载数和已知用量分开记录；两边都通过
是未观察到改善，不是学习成功。存在退步、执行不完整、组成不可比或改善分支未加载草稿时，不给出可靠改善结论。
这些任务仍是模型提出的有限检查，不能证明全面正确、独立样本规模、泛化或完整发布资格；没有自动启用、晋升或回滚权限。

语义模式使用单个 44 槽预留，包含上述最多 24 个执行请求、12 个裁判校准请求和八个答案判分请求。
`semantic-v1` 的静态提示 hash、模型 route 与顺序固定到计划；每次请求先持久化输入 digest、发送标记和时间。
裁判是原生 LLM 的无工具、无 Agent Loop、单答案独立请求，与执行和 proposer 上下文分离；只传任务与原始答案，
不传草稿、组别标签、参考答案、期望结论或另一组答案。它复用来源模型，不代表不同模型家族的独立性；答案内容本身
可能暴露风格或自述信息，因此不是完美匿名实验。每次最多 1000 输出 token、60 秒取消通知，无自动模型重试。

在创建任何试验 Agent 前，按封存顺序分别评参考正例、替代正例和负例；两正例必须 pass，负例必须 fail。
第一处错误或 uncertain 立即 `rejected/judge-calibration-failed`，保留整个预留及实际用量，不再挑题、重校准或执行。
模型请求中断、非法输出或无效引用为 uncertain；已知 usage 保留，未知不按零，冷恢复不重发。
校准完成后才执行八个分支，并逐个以同一盲判请求评最终答案；判分只有 pass/fail/uncertain，必须引用任务或答案中的
原文，Host 检查引用确实存在。这只能约束输出自洽，不能证明裁判推理或引用与结论正确。
语义实验的 comparison 使用这八个判分；每个 leg 原 `passed` 仍保留字面断言结果，不覆盖它。
任一语义 uncertain、原生执行不完整、组成不可比或改善分支没有加载 Skill，都不能产生可靠改善结论。
Web 分别显示语义/字面得分、裁判校准和请求标记；总已知 token/耗时含裁判，任务请求数与裁判标记分开。
请求标记不是计费回执。有限模型判分仍不能代替真实文件、视觉或外部效果验收，也不授予启用或回滚权限。

file-records-v1 使用同一个原生实验账本、Jobs 和八分支计划，每分支最多12次请求、每次最多4000输出token、总时限600秒，
整组预留96槽，不额外调用语义裁判。两个分支复用来源模型与 cwd，各自只写全新 `.evoforge/workflow-trials/<trialId>/<index>/`
目录；输入以原生 fs 的 createIfAbsent 创建，旧目录或逃逸符号链接拒绝复用，不覆盖任何既有产物。
仅在新评测 Agent 内挂载官方 `tool-fs` / `tool-present`，同样冻结 Skill/Tool 组成，原生 sandbox 为 workspace-write。
只准读取声明输入与结果、写改结果文件、展示结果；命令、网络、输入修改、未声明路径、嵌套调度和提权均拒绝。
完整首请求比对仅额外规范化准确的本分支任务目录；模型、工具、其他提示内容和输入 hash 仍须一致。
这是对可信原生工具的窄路径策略，不是防恶意 Host 插件或外部并发文件替换的内核隔离承诺。

Host 从真实文件字节和原生关联 Tool 结果核对：输入不变、全部内容实际读取、结果实际写入、最后写入后的完整回读、
随后成功的原生 present，以及零越界。局部读取、截断读取或只声称已交付不算完整；分页读取可覆盖全部行。
JSON 检查忽略对象键顺序与空白，但逐项核对类型和值，拒绝缺项和额外字段。工具错误单独记录，普通 I/O 错误恢复后
仍可完成任务；越界尝试不能靠后续成功洗掉。事实错误与交付不完整分别显示，不再叫字面断言得分。
结果文件保留，终态控制面显示同 Workspace 的有限产物快照、hash、输入读取状态及期望/实际事实差异；运行中不返回这些内容。
这只证明四份固定文件工作流，不等同真实渠道交付、广泛泛化或超过 Hermes。未完成实验不自动重发、重评或换题。

私有 `evoforge_conversation_draft_trials` Domain 最多保留 20 份计划，保存来源 hash、原生 Session id、断言结果和至多
128000 字节的首请求快照；其他请求保留 digest，原生 Session 日志保持执行权威。结果和状态先写入再返回；存储失败停止
该账本的新调用。未完成计划在冷恢复时标为 uncertain，不自动重发；卸载或撤回策略取消并等待当前工作，不删除原生历史。
控制面只返回计数、有限结果与用量；文本协议不返回测试输入/答案，文件协议仅按上述终态规则返回产物和事实差异；均不返回请求快照。dispatch marker 是保守预留，不等于已测量调用；
缺失用量和费用保持 unknown。完整的未来 Session 验证、启用与精确回滚仍须经过其他独立门禁。

仅当失败根计划为 uncertain、全部 dispatch marker 为零且没有任何分支结果时，管理员可配置
`retryFailedTrials: [{ trialId, expiresAt }]` 明确授权一次初始化恢复。默认缺省，最多十项；绑定原计划，
不得绑定恢复子记录，加载时过期时间不得晚于当前时间 24 小时，预留时再次检查未过期和共享日预算。
原计划不覆盖、不删除；恢复以确定性的 `retryOf` 生成新身份和八个新原生 Session id，保留相同草稿完整快照、
测试题顺序、分区、输入 digest 和 provider/model。两次各自预留 24，不能回收旧预留绕过预算。
任意已记录发送、已产出结果、来源/模型变化、无效父子关系、过期或撤回授权均阻止新的恢复；并发、重启或跨日
不能生成第三次尝试。恢复结果不是新的独立样本，Web 明确显示恢复关联，失败根记录保持可见。
这不是通用模型重试，不允许挑选有利答案，也不增加启用或晋升权限。

### 2.6 普通纠正 Skill 的独立评测后人工启用

普通纠正不伪装成 Goal-qualified Candidate。新原生实验在预留时另外封存当前 Generation id（可以为空）及选择序号；
每次执行前后的来源复核同时要求选择未变。历史计划缺少该封存仍可读、可按原规则结束，但不能追补启用资格；
初始化恢复保留父计划原封存，包括“未封存”的历史状态。

独立 Host 门禁只接受当前学习与评测策略仍存在的完整语义实验或上述文件实验；关闭未来语义评测不使已完成证据失效。
语义实验须裁判校准与判分完整；文件实验须按封存计划重算每个文件的交付与事实结果，拒绝篡改标记或产物快照。
实验必须有四组请求组成可比、四个草稿答案均通过、
至少一个 holdout 相对基线改善且两个 holdout 实际加载正文、两个 retention 的两边均通过、零退化。
结论从原始分支与独立裁判记录重新核对，不接受 UI 上传结论；字面得分、相同两边均通过、未加载、缺项或 uncertain
不授予资格。文本协议只覆盖有限、模型提出的自包含文本任务，不证明文件或工具效果；文件协议只覆盖所声明的文件任务。
两者均不证明外部渠道效果、广泛安全/泛化或 Hermes 替代能力，也不是模型自评成功。

用户在原生控制台核对完整正文后明确确认；没有自动启用、额外模型请求或新预算。启用前物理重读原纠正/当前反馈、
核对 provider/model 与 Skill 目录，拒绝同名覆盖及已变化的基线。单个原始 `SKILL.md` 以准确字节封装，使用明确的
`conversation-skill-lineage-v1` 绑定草稿、来源、治理、实验和内容 hash；不虚构旧 Candidate 的 admission/Goal，也不添加
未被评测的引用文件。沿用原有 Generation Storage、materializer、binder 和选择日志，不建立第二版本库。

发布先产生 inactive Generation，再复核来源并原子选择；写入选择时再次核对页面确认时的选择序号，拒绝过期确认和
并发基线漂移。回滚恢复评测时同一基线后，刷新并再次明确确认可以启用同一内容地址版本；不重跑评测、不改写原实验封存。
当前 Session 仍固定原版本；新 Session 才注册原生 Skill，实际读取仍由原生 `skill` Tool 留痕。
明确回滚携带页面显示的 exact Generation id；目标已变则拒绝，只改未来指针，不改变已固定 Session 或撤销已发出的效果。
被后续版本继承的 Skill 不能假装通过一次整代回滚单独删除。卸载停止新请求并等待已接受的原生读取/写入完成，保留历史。

Web 的“可启用”“已选为未来版本”和“实际加载”不是同一结论；启用资格不把失败历史变为成功。新计划字段和新谱系
不保证旧二进制可读；能力版本回滚不等于覆盖账本或降级插件二进制。此门禁的受控测试不能代替真实未见任务效果与 Hermes 比较。

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
