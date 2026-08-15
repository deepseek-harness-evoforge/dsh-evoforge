# 公开 Agent 自进化项目证据审计

> 审计日期：2026-08-15
> 范围：公开论文、官方 GitHub、官方文档；不使用媒体转述作为结论依据
> 目的：校准 `EvoForge` 自进化设计，识别真正已有的能力、未解决的问题和可形成差异的位置

## 1. 结论先行

此前的 `EvoForge` 设计参考了 Hermes Agent 本体，但**没有完成足够广泛的公开自进化项目横向审计**。这次审计后，需要诚实修正三个判断：

1. “从执行轨迹生成 Skill 候选，再做 Baseline/Candidate 评测”已经不是独一无二的设计。最接近的公开实现是 [NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution) 和 [Canvas Meta-Agent](https://github.com/canvas-org/meta-agent)。
2. 当前最成熟、最值得直接复用的候选搜索器不是自研反思提示词，而是 [DSPy/GEPA](https://github.com/gepa-ai/gepa)：它读取完整轨迹和文本反馈，维护 Pareto 候选，并在少量 rollout 下做反思式变异。
3. 公开项目普遍擅长“生成更好的候选”，却普遍没有解决**一个正在服务用户的常驻 Agent 如何安全上线新能力**：Session 内版本固定、KV Cache 前缀稳定、崩溃恢复、非阻塞审批、原子晋升、线上回归后的自动回滚，仍是 `EvoForge` 最有价值的差异化空间。

所以不应把产品定位为“另一个 prompt optimizer”，而应定位为：

> DSH 上的可证明能力发布与持续进化插件：复用成熟优化器产生候选，专注把真实任务证据、隔离试验、Session 固定版本、缓存纪律、权限边界、原子晋升和回滚连接成一个能长期运行的闭环。

## 2. 什么才算“自进化”

本报告使用以下判定标准，避免把普通 Memory 或一次性反思包装成自进化：

| 层级 | 定义 | 例子 | 是否算持续自进化 |
|---|---|---|---|
| L0 状态记忆 | 保存事实、偏好、历史 | Letta memory block | 否；它改变上下文，不证明能力提高 |
| L1 单任务修正 | 在当前任务中反思、重试或润色 | Self-Refine | 否；没有形成可复用版本 |
| L2 跨尝试经验 | 保存反思，影响同类任务后续尝试 | Reflexion | 弱相关；有学习，但没有能力发布 |
| L3 可复用能力增长 | 产生可持久化 Skill、prompt 或 workflow | Voyager、Hermes Skill | 是，但若没有对照评测，仍可能退化 |
| L4 经验驱动优化 | 生成多个候选，以任务结果选择更优版本 | GEPA、AFlow、ADAS | 是；通常是离线优化 |
| L5 可运营持续进化 | 线上采集信号、隔离评测、版本晋升、监测、回滚 | 公开项目尚不完整 | `EvoForge` 的目标 |

“Agent 会写自己的文件”不等于自进化；“模型说新版本更好”也不等于能力提高。至少要区分：进化对象、反馈信号、候选生成、评估选择、发布与回滚。

## 3. 总览矩阵

“未提供”表示本次审计的一手公开材料没有提供该机制，不代表仓库永远不存在相关实验分支。

| 项目 | 首次公开/论文 | 进化对象 | 反馈与候选 | 评估/选择 | 回滚与长时运行 | 成本和成熟度 |
|---|---:|---|---|---|---|---|
| Hermes Agent 内建循环 | 2026 活跃产品 | Memory、Skill | 会话纠正、复杂任务、失败路径；后台 review 或前台 `skill_manage` 写入 | 没有 Baseline/Candidate 的任务级证明 | 写审批可选；Curator 有备份/归档恢复；Gateway 可常驻 | 产品化程度高；默认自由写 Skill，正确性风险仍在 |
| Hermes Agent Self-Evolution | 2026 | Phase 1 Skill；其余规划为工具描述、系统提示、代码 | SessionDB/合成/golden 数据；DSPy+GEPA | train/val/holdout、测试、大小、语义和 benchmark gate | Git branch/PR/revert；连续循环仍是 Phase 5 规划 | Phase 1 已实现，仓库仍早期；官方估算优化约 $2–10，完整 benchmark 另计 |
| Voyager | 2023-05 | Minecraft JavaScript Skill 库 | 环境反馈、执行错误、GPT-4 自验证；迭代改代码 | 当前任务成功后入库；不是跨候选 held-out 选择 | checkpoint 可恢复；没有原子发布或自动回滚 | 约 160 轮 $50；经典研究原型，领域封闭 |
| Reflexion | 2023-03 | Episodic verbal reflection | 环境/标量/语言反馈转成反思文本 | 后续 trial 的任务结果 | 可保存日志和 resume；无版本晋升/回滚 | 研究代码；多 trial，官方提示 GPT-4 重跑费用显著 |
| Self-Refine | 2023-03 | 当前输出 | 同一模型生成 feedback，再 refine | task-specific stop；没有跨版本选拔 | 单任务内最多若干轮；无持久进化 | 极简研究方法；每轮约增加 feedback + refine 两次模型调用 |
| Darwin Gödel Machine | 2025-05；ICLR 2026 | Coding agent 自身 Python 代码 | 从 archive 取父代，FM 自修改 | SWE-bench/Polyglot 经验评分，保留开放式谱系 | archive 可回到祖先；Docker；非生产 active-version 机制 | 高成本研究搜索；官方代码规模小、风险警告明确 |
| ADAS / Meta Agent Search | 2024-08；ICLR 2025 | Agent prompt、tool use、control flow 的 Python 设计 | Meta agent 参考 archive 编写新 Agent | 各领域 benchmark 分数，归档发现 | 有 archive，无生产发布/回滚；执行未信任代码 | 研究原型；每领域需定制 evaluator，成本高 |
| AFlow | 2024-10；ICLR 2025 Oral | code-represented workflow、prompt、edge | LLM 在 MCTS 中扩展 workflow | validation 多次执行，MCTS 回传分数 | 保存各轮 workflow；没有线上原子回滚 | 比 ADAS 更受约束、可复现；仍是 benchmark 优化器 |
| Agent0 | 2025-11；ICML 2026 | Curriculum Agent 与 Executor Agent 的模型权重 | 两个同源 Agent 以 frontier task 和工具使用相互施压，GRPO/ADPO 更新 | 合成任务难度/可解性、工具奖励和外部 reasoning benchmark | 训练 checkpoint 可选旧权重；不是 live agent 的版本发布 | 需要 RL/GPU 训练，研究实现；与 P0 的无权重更新路线不同 |
| EvoAgentX | 2025-07 | 多 Agent prompt、tool config、workflow topology | 集成 TextGrad、MIPRO、AFlow | 内建 benchmark/evaluator，val/test | 可序列化 workflow；没有明确 promotion/rollback 协议 | 活跃综合框架；进化层是多种现有算法的集成 |
| DSPy + GEPA | DSPy 2023；GEPA 2025-07/ICLR 2026 | 任意文本参数、prompt、DSPy program | 轨迹 + actionable textual feedback；反思式 mutation/merge | Pareto frontier、metric、valset；返回最佳 program | 保存候选由调用方负责；无线上发布语义 | 本表中最成熟的通用优化组件之一；仍依赖高质量 metric |
| TextGrad | 2024-06；Nature 2025 | prompt、答案、代码等文本变量 | LLM 生成“文本梯度”，TGD 更新 | 用户定义 TextLoss/eval | 原值可由应用保存；没有版本发布/回滚 | 成熟研究库；每步需要额外 critic/backward/update 调用 |
| LangMem Prompt Optimizer | 公开库活跃 | 单/多 system prompt | conversation trajectory + feedback；gradient/metaprompt/prompt-memory | 直接返回改写 prompt；没有内建 holdout selection | 有后台 ReflectionExecutor；无版本 promotion/rollback | 工程 API 简洁；官方给出每次 1 到 10 个 LLM 调用 |
| Letta | 持续活跃 | 自编辑 memory blocks | Agent 通过 memory tool 更新持久上下文 | 无候选对照或收益选择 | Stateful；read-only block；写入 last-write-wins | 成熟 stateful agent 平台，但属于 Memory，不是自进化优化器 |
| Canvas Meta-Agent | 2026 | 完整 harness；实验性地再进化 proposer skill | traces、结果、成本；提出单一假设并改 harness | search/selection/final-test，可配置 holdout 接受 | 完整候选目录和版本化 proposer；生产晋升/回滚未定义 | 非常相关但早期；公开结果仅单一小 benchmark run |

## 4. 分项目证据审计

### 4.1 Hermes Agent 内建自改进

**定位与进化对象**

Hermes 把短事实放入 Memory，把长流程放入 Skill。Agent 可以通过 `skill_manage` 创建、patch、edit、delete Skill；官方文档把它称为 procedural memory，并列出触发场景：复杂任务成功、遇到错误后找到路径、用户纠正、发现非平凡 workflow。[Hermes Skills 官方文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)

**反馈、生成与选择**

- 前台 Agent 或约每若干轮触发的后台 review 根据会话经历直接创建/修改 Skill。
- 内建循环的主要“选择信号”是模型对经验的复盘，而不是同任务 Baseline/Candidate 对照。
- `patch` 被推荐为 token 更省的修改方式；Skill 采用 progressive disclosure，正文只在调用时加载，这与 DSH 的缓存目标相容。[Hermes Skills 使用指南](https://hermes-agent.nousresearch.com/docs/guides/work-with-skills/)

**人工、安全与回滚**

- `skills.write_approval` 默认是 `false`，即 Agent 默认可以直接写 Skill；打开后，写入会持久化到 pending 队列，由 `/skills diff/approve/reject` 异步审核。[写审批官方文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- Curator 的确定性清理可以将长期不用的 Skill 标为 stale/archived；LLM consolidation 默认关闭。Curator 修改前可以备份，归档可 restore，且不会自动删除。[Curator 官方文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator)
- Curator 的 LLM consolidation 一次完整扫描可能需要 50–100 次 API 调用，所以官方默认关闭。

**长处**

- 已经进入真实 CLI/Gateway 产品，而不只是论文脚本。
- 前台任务与后台 review 分离；审批不会阻塞原会话。
- Skill progressive disclosure、patch 优先、Curator 防膨胀，都是值得借鉴的工程细节。

**不足**

- 内建 self-improvement 没有证明“改后更好”，模型既是复盘者又是作者。
- 写审批默认关闭，对弱模型或敏感环境偏激进。
- Curator 的 use count/idle time 只能证明活跃度，不能证明质量；归档恢复也不是逐版本的能力发布。
- 官方 issue 已出现后台 review 把会话叙事和代码块写进 `SKILL.md`、导致 Skill 膨胀的实例，说明“会整理 Skill”本身仍需要结构和尺寸 gate。[官方 issue #55255](https://github.com/NousResearch/hermes-agent/issues/55255)

**对 EvoForge 的启示**

借鉴它的异步 pending inbox、patch 优先、progressive disclosure、provenance/pin/restore；不要复制“复盘后直接写 active Skill”。

### 4.2 Hermes Agent Self-Evolution：与当前设计最接近的直接竞品

NousResearch 已在 2026 年公开独立仓库 [hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution)。它明确运行在 Hermes Agent 之外，读取 SessionDB 和轨迹，使用 DSPy+GEPA 优化 Skill；README 显示 Phase 1 已实现，工具描述、系统提示、代码和连续循环仍是规划。[官方 README](https://github.com/NousResearch/hermes-agent-self-evolution)

**完整闭环**

1. 读取当前 Skill/prompt/tool；
2. 从 synthetic、SessionDB、golden 或自动检查生成 eval dataset；
3. GEPA 读取 execution trace，提出候选；
4. 候选经过 tests、大小、缓存兼容、语义保持和 benchmark gate；
5. train/validation/holdout 比较 accuracy、cost、latency，并做统计显著性检查；
6. 输出 Git branch + PR，人工 review/merge；Git revert 回滚。[官方 PLAN](https://github.com/NousResearch/hermes-agent-self-evolution/blob/main/PLAN.md)

**公开状态与成本**

- README：Phase 1 Skill evolution 已实现，其余 Phase 2–5 planned。
- 官方估算 GEPA 单次优化约 `$2–10`；但计划中的 TBLite 回归门约 `$20–50`，TerminalBench2 完整验证约 `$50–200`，所以“优化器成本”不能等同“完整晋升成本”。[PLAN 的 Cost 与 benchmark 部分](https://github.com/NousResearch/hermes-agent-self-evolution/blob/main/PLAN.md)
- 计划为每个 Skill 生成约 15–30 个例子，并要求至少一个 Skill 提升 10%、TBLite 回归不超过 2%、人工看 diff 合理。

**长处**

- 直接承认 eval dataset 是核心资产，而不把候选生成当核心难题。
- 将真实 Session、合成样本、golden、Skill-specific deterministic check 分层。
- 先 Skill、再工具描述、再 system prompt、最后 code，风险顺序合理。
- 尺寸限制、holdout、缓存兼容、PR 和 Git lineage 都是必要 gate。

**不足**

- 当前只实现 Phase 1；“连续自进化”仍是规划，不是已完成能力。
- 全部改善必须 PR + 人工 merge，可信但人工介入较多，不是非阻塞自动晋升。
- 没有描述 live Session 固定旧版本、并发 Session、崩溃时 active pointer 的事务语义。
- 真实 Session 挖掘依赖 LLM-as-judge；合成数据和同源 Judge 可能共同偏置。
- 计划把工具实现中的 bug 修复列为进化目标；这与 `EvoForge`“只做 DSH 新能力扩展、不承担 Core bug 修复”的产品边界不同。

**对 EvoForge 的直接影响**

不得再把“GEPA + held-out + Git PR”作为独特卖点。应复用或兼容 GEPA，把差异放在：

- DSH 插件内一键启用，而非外部离线研究仓库；
- Session Generation pin 与 fork/resume 继承；
- KV Cache composition 作为第一优先级 hard gate；
- 明确胜出的纯指令可以对**未来 Session**原子晋升；
- 模糊项进入异步 inbox，不阻塞当前会话；
- active pointer 崩溃恢复、线上回归自动回滚；
- DSH Goal、feedback、test、Draft PR 形成软件交付 outcome adapter。

### 4.3 Voyager

Voyager 于 2023 年 5 月公开，是 Minecraft 中的开放式终身学习 Agent。它包含 automatic curriculum、可增长的 executable skill library，以及基于环境反馈、执行错误、自验证的迭代代码改进。[论文](https://arxiv.org/abs/2305.16291) · [官方代码](https://github.com/MineDojo/Voyager)

**闭环**

- curriculum 提出“有挑战但可完成”的下一任务；
- 根据任务描述和环境状态检索相关 Skill；
- GPT-4 生成 JavaScript；
- 执行后收集环境反馈和解释器错误；
- 另一个 GPT-4 critic 判断任务是否完成并给出失败建议；
- 成功程序加入 Skill 库，通过 embedding 供未来组合复用。[论文 PDF 的 iterative prompting](https://voyager.minedojo.org/assets/documents/voyager.pdf)

**长处**

- 进化的是可解释、可组合、可执行的能力，而不只是聊天摘要。
- 环境给出强反馈，Skill 只有完成当前任务后才入库。
- checkpoint 支持学习中断后 resume；Skill 库可以迁移到新世界。

**不足**

- “当前任务成功”不等于“Skill 在未见任务上更好”；没有 Baseline/Candidate held-out 选择。
- critic 与生成器都依赖 GPT-4，自验证错误可能污染库。
- Skill 库只增长，没有完整的冲突、淘汰、版本晋升和自动回滚机制。
- 安全成立在 Minecraft 研究环境，不能直接外推到有秘密、支付、部署权限的通用助理。
- 官方 FAQ 估算 GPT-4 约 160 次迭代花费约 `$50`，且建议先人工观察行为，避免无效消耗。[官方 FAQ](https://github.com/MineDojo/Voyager/blob/main/FAQ.md)

**启示**

采用“环境反馈 + 执行错误 + verifier”的多源证据，以及 Skill 组合；不要采用“成功一次即入 active library”。

### 4.4 Reflexion

Reflexion 于 2023 年 3 月公开，使用 verbal reinforcement：Agent 把任务反馈转成语言反思，写入 episodic memory，并在后续 trial 中作为上下文使用，而不更新模型权重。[论文](https://arxiv.org/abs/2303.11366) · [官方代码](https://github.com/noahshinn/reflexion)

**进化对象与信号**

- 对象是反思文本和后续决策上下文，不是持久 Skill 或 harness 版本。
- 信号可以是 scalar、free-form、external 或 internally simulated。
- 后续相同/同类任务是否成功，是反思有用性的间接验证。

**长处**

- 极低实现门槛，不需要训练权重。
- 把“错误”压缩为可执行语言经验，对短期重试非常有效。
- 官方代码支持保存日志和从 trial 位置 resume。

**不足**

- 反思会持续占用上下文，容易累积错误或过拟合单一 episode。
- 不生成独立 Candidate，不做跨样本保留能力评测，也没有版本发布/回滚。
- 官方仓库明确提示复现实验涉及显著 GPT-4 API 费用。[官方 README](https://github.com/noahshinn/reflexion)

**启示**

Reflexion 适合作为 Candidate proposer 的输入压缩方式，不适合作为 promotion policy。反思只能提出假设，不能自己批准自己。

### 4.5 Self-Refine

Self-Refine 于 2023 年 3 月公开：同一个 LLM 先生成输出，再生成 actionable feedback，再据此 refine，循环到 task-specific stop；不需要监督训练、RL 或人工参与。[论文](https://arxiv.org/abs/2303.17651) · [项目页](https://selfrefine.info/)

**长处**

- 最小可用的 feedback → refine 原语。
- 对当前交付物的润色、代码优化和约束修正有价值。
- 论文在七类任务中报告相对 direct generation 的提升。

**不足**

- 它优化当前输出，不改变未来 Agent 能力，不属于持续能力进化。
- 同一个模型同时生成、批评、修正，存在相关性偏差。
- 论文错误分析显示 feedback 可能错误/泛化，refinement 可能忽略反馈或引入新问题。
- 实验最多进行若干轮；每轮至少增加 feedback 与 refine 两次调用，成本和延迟直接叠加。

**启示**

可以把 Self-Refine 作为一次 Candidate 内部的局部改写器，但不能用“迭代到模型满意”代替外部 evaluator。

### 4.6 Darwin Gödel Machine（DGM）

DGM 于 2025 年 5 月公开，后进入 ICLR 2026。它从 archive 中抽取一个 coding agent，用 foundation model 修改该 Agent 自身 Python 代码，再通过 SWE-bench/Polyglot 经验验证，将不同谱系保留在开放式 archive 中。[论文](https://arxiv.org/abs/2505.22954) · [官方代码](https://github.com/jennyzzt/dgm) · [Sakana AI 官方说明](https://sakana.ai/dgm/)

**长处**

- 真正把 agent harness 代码纳入搜索空间，包括编辑工具、长上下文管理、peer review 等。
- 不是只保留单一冠军，而是保留多条高质量谱系，降低局部最优和灾难性覆盖。
- 对候选运行真实软件工程 benchmark；论文报告 SWE-bench 20.0% → 50.0%、Polyglot 14.2% → 30.7%。

**不足**

- benchmark 成为唯一现实：如果测试覆盖不足，Agent 会优化可测指标而非用户真实目标。
- 开放式 archive 是搜索资产，不等于线上版本、active pointer、灰度发布或自动回滚。
- 运行未信任模型生成代码。官方仓库明确警告潜在破坏行为并要求 Docker；论文声称实验使用 sandbox 和 human oversight，但这不是通用权限系统。
- 官方实现是小型研究代码库，运行一次完整 SWE-bench 搜索的时间/模型成本很高，未给出面向个人用户的预算控制。

**启示**

借鉴 archive、谱系、经验验证；P0 不允许自改 evaluator、权限、部署策略或进化器本身。代码级开放式进化应晚于 Skill 级闭环，并只产出 Draft PR。

### 4.7 ADAS / Meta Agent Search

ADAS 在 2024 年 8 月提出，ICLR 2025 收录。Meta Agent Search 让一个 meta agent 参考历史 archive，直接编程新的 Agent 设计；因为搜索空间是 Python 程序，它理论上覆盖 prompt、tool use、control flow 和任意组合。[论文](https://arxiv.org/abs/2408.08435) · [官方代码](https://github.com/ShengranHu/ADAS)

**长处**

- 将 Agent 设计从手工 prompt engineering 提升为可评测的程序搜索。
- archive 为新候选提供成功/失败先例；论文还测试跨领域、跨模型迁移。
- 搜索空间足够开放，可以发现人类没有预设的 workflow。

**不足**

- 每个新领域都要人工实现 `evaluate_forward_fn`、数据和 domain prompt；核心瓶颈仍是 evaluator。
- 官方仓库按领域复制自包含实验目录，适合论文复现，不是持续服务架构。
- 无 train/val/test 发布协议、live session 语义或线上回滚。
- 官方 README 明确警告会执行未信任的模型生成代码，可能发生破坏。[安全警告](https://github.com/ShengranHu/ADAS#safety-consideration)

**启示**

自由搜索适合研究阶段，不适合 P0。`EvoForge` 应使用窄 artifact schema 和 protected evaluator，先证明一个 Skill 的可控改进。

### 4.8 AFlow

AFlow 于 2024 年 10 月公开，ICLR 2025 Oral。它用受约束的 Operator（Generate、Format、Review/Revise、Ensemble、Test、Programmer 等）和 code-represented edge 表示 workflow，再用 MCTS 选择、扩展、评估和回传。[论文](https://arxiv.org/abs/2410.10762) · [官方代码](https://github.com/FoundationAgents/AFlow)

**候选与选择**

- 一个树节点是一套完整 workflow；
- LLM 根据父 workflow 和历史经验修改代码/prompt；
- validation set 上多次执行以降低随机性；
- score 回传到 MCTS，持续平衡探索与利用；
- 官方 CLI 默认可设置 sample、max rounds、validation rounds 和 convergence。

**长处**

- 相比 ADAS 的任意 Python，Operator 提供更小、更可解释、更高命中率的搜索空间。
- 把失败路径存在搜索树里，避免每轮从零反思。
- 论文区分优化期成本和部署后 workflow 的推理成本，并报告小模型 workflow 在特定任务可用 GPT-4o 约 4.55% 的推理美元成本胜出。

**不足**

- 优化仍依赖静态 benchmark/validation；部署后持续学习不是其目标。
- 官方仓库提示从 MetaGPT 迁移后的部分 Operator 可能有 bug，成熟度仍是研究工具。
- 保存各轮 workflow 可以手工回退，但没有发布审批、Session 固定版本或自动回滚协议。
- MCTS 的大量候选 × 多轮 validation 会显著消耗 token；最终 workflow 便宜不代表搜索过程便宜。

**启示**

采用“小而稳定的 mutation operator 集”，而不是允许模型任意重写所有文件；P0 的 operator 可以只有 replace/clarify/delete 三种 Skill 变更。

### 4.9 Agent0：真正的模型级共进化，但不是 DSH 插件路线

Agent0 于 2025 年 11 月公开，后进入 ICML 2026。它不依赖人工标注数据，而是让两个从同一 base LLM 初始化的 Agent 共进化：Curriculum Agent 生成当前 Executor 难度边界附近、需要工具的任务；Executor Agent 学会多轮工具推理，能力增强又迫使 Curriculum 继续提高难度。[论文](https://arxiv.org/abs/2511.16043) · [官方代码](https://github.com/aiming-lab/Agent0)

**进化对象与反馈**

- 进化对象是两个 Agent 的**模型权重**，不是 Skill、prompt 或 harness 文件。
- Curriculum Agent 使用 GRPO，奖励综合 Executor 的难度/不确定性、任务多样性和工具使用。
- Executor 从难度接近 50% 可解边界的合成任务池学习，用 ADPO 处理伪标签歧义，并支持多轮工具调用。
- 论文以 reasoning benchmarks 评估三轮共进化，报告 Qwen3-8B-Base 数学平均 49.2 → 58.2，并展示逐轮上升。[论文算法与结果](https://arxiv.org/abs/2511.16043)

**长处**

- 自动 curriculum 不只复现已有失败，而是主动寻找“刚好够难”的能力边界。
- proposer/executor 相互施压，比静态合成数据更能持续产生新任务。
- 工具使用进入课程奖励和 executor 学习，而不是训练后临时挂载。

**不足**

- “zero data”是零外部训练数据，不是零算力、零监督假设或零成本；它依赖双 Agent、多样本 rollout、RL 和 GPU 训练。
- 自动 curriculum 与 self-reward 仍可能共同形成偏差；benchmark 结果不等于真实用户 workflow 改善。
- 权重更新难以解释到具体规则，也无法像 Git Skill diff 一样做低成本人工审查。
- 官方研究代码没有 live Session 固定版本、权限、审批、原子晋升或外部副作用回滚。

**对 EvoForge 的启示**

P0 不应引入 RL 或权重训练。可借鉴的是“frontier case generation”：当真实失败样本太少时，由一个受约束 Curriculum Adapter 围绕已知能力边界生成更难但可验证的 Trial cases；这些合成 case 只能用于 search/validation，最终晋升仍需独立真实或 deterministic final-test。

### 4.10 EvoAgentX

EvoAgentX 于 2025 年 7 月发布论文，是构建、执行、评估和优化多 Agent workflow 的综合框架。其 evolution layer 集成 TextGrad、AFlow、MIPRO，并称可以优化 prompt、tool configuration 和 workflow topology。[论文](https://arxiv.org/abs/2507.03616) · [官方代码](https://github.com/EvoAgentX/EvoAgentX)

**长处**

- 生成、执行、评估、优化分层，接口比单篇算法项目完整。
- 为 HotPotQA、MBPP、MATH、GAIA 提供内建 benchmark/evaluator；README 给出 50 validation + 100 test 的统一比较。
- 有工具、memory、workflow persistence 和 HITL，适合作为研究集成平台。

**不足**

- “Self-Evolution Engine”主要是集成已有优化算法，而非一种已验证的线上持续进化协议。
- 论文结果集中在 benchmark/offline optimization，未证明真实用户长期使用中的保留、回滚和抗污染。
- HITL 默认未激活时请求会自动批准；官方教程还标注 multi-turn conversation 尚未实现。[HITL 官方教程](https://evoagentx.github.io/EvoAgentX/tutorial/hitl.html)
- 框架覆盖面很大，依赖和抽象明显重于“一个 DSH 可插拔扩展”。

**启示**

可以借鉴 adapter 统一不同 optimizer/evaluator；不要复制整个多 Agent workflow 平台。DSH 已有 Goal、Skill、Tool、Session、Storage、Approval，应做窄集成。

### 4.11 DSPy / GEPA

DSPy 将 LM program 的 prompt、few-shot example、甚至权重视为可优化参数。官方 optimizer 包括 BootstrapFewShot、MIPROv2、SIMBA、GEPA 等；用户提供 program、metric 和少量 train input。[DSPy Optimizer 官方文档](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md)

GEPA 于 2025 年 7 月公开，ICLR 2026 收录。它把完整 execution trace、错误、约束违例、profiling 等“可行动文本反馈”交给反思模型，生成针对性 mutation；从 Pareto frontier 选择在不同样本上有优势的候选，并可 merge 互补经验。[论文](https://arxiv.org/abs/2507.19457) · [官方实现](https://github.com/gepa-ai/gepa) · [DSPy GEPA 说明](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/api/optimizers/GEPA/overview.md)

**长处**

- optimizer 与被优化系统通过 adapter/metric 分离；适合 out-of-tree 插件。
- 不只看 scalar，还看失败原因，样本效率高于盲目随机搜索。
- Pareto frontier 保留互补策略，优于只沿单一冠军 hill-climb。
- DSPy 是较成熟、持续发布的库；GEPA 已有独立包和 DSPy 集成。

**不足**

- “If you can measure it, you can optimize it”反过来也成立：metric 错了，优化就会稳定地做错事。
- Pareto frontier 解决探索，不解决真实用户分布、数据泄漏、权限或部署安全。
- GEPA 返回优化 program/candidate；版本存储、active deployment、Session consistency、rollback 都由调用方实现。
- 论文的 35× fewer rollouts 是相对特定 RL 基线的实验结论，不代表一次优化便宜；官方 README 仍描述约 100–500 次 evaluation 的量级。[GEPA 官方 README](https://github.com/gepa-ai/gepa/blob/main/README.md)

**启示**

P0 候选生成器应该定义 `EvolutionOptimizer` adapter，首个实现优先接 GEPA；不要把 GEPA 绑进前台 runtime，也不要让它成为 durable state authority。

### 4.12 TextGrad

TextGrad 于 2024 年 6 月公开，2025 年发表于 Nature。它借用 autograd 接口：用户定义可优化的文本 Variable 和自然语言 TextLoss，LLM 产生 textual gradient，TGD 再更新 prompt、代码或答案。[论文](https://arxiv.org/abs/2406.07496) · [官方代码](https://github.com/zou-group/textgrad)

**长处**

- 对复合 LM 系统的多个文本节点做 credit assignment，比一次整体重写更精细。
- PyTorch 风格 API 简洁；可以优化 prompt、solution、code 等不同对象。
- 支持 LiteLLM 和 cache 开关，工程可接入性较好。

**不足**

- “gradient”是模型生成的语言建议，不具备数学梯度的保证。
- TextLoss 的偏差会直接传播到更新；框架不提供 held-out promotion 或回归保护。
- 每次优化步包含 forward、loss/feedback、backward/update 等额外模型工作；多节点反传成本明显。
- 适合 optimizer 组件，不是持续 Agent 产品。

**启示**

当一个 Skill 由多个 section 组成、需要定位责任时可作为可选 optimizer；P0 不需要同时集成 GEPA、TextGrad、MIPRO，先用一个接口和一个实现。

### 4.13 LangMem Prompt Optimizer

LangMem 同时提供 Memory 管理和 prompt optimization。其 `create_prompt_optimizer` 接收 conversation trajectories、feedback 和原 prompt，支持 `prompt_memory`、`metaprompt`、`gradient` 三种改写方式；也提供多 prompt attribution。[官方 API](https://langchain-ai.github.io/langmem/reference/prompt_optimization/) · [官方指南](https://langchain-ai.github.io/langmem/guides/optimize_memory_prompt/) · [官方代码](https://github.com/langchain-ai/langmem)

**长处**

- 最贴近“从真实对话反馈改 system prompt”的工程 API。
- `ReflectionExecutor` 可以在本地线程或远端后台调度，不阻塞 hot path。[官方 Reference](https://langchain-ai.github.io/langmem/reference/)
- 官方明确成本：`prompt_memory` 约 1 次调用，`metaprompt` 约 1–5 次，`gradient` 约 2–10 次，适合低成本候选生成。

**不足**

- API 返回一个 improved prompt，不提供 Baseline/Candidate held-out 选拔、版本晋升和回滚。
- 示例容易把一次用户纠正泛化为“always”规则，存在指令膨胀和过拟合风险。
- background reflection 解决延迟，不解决正确性。

**启示**

其轻量 proposer 可以作为低预算模式；输出必须保持 inactive，后续仍走同一 Trial/Release pipeline。

### 4.14 Letta：应明确剔除为“相邻能力”

Letta 的 memory block 是始终位于上下文中的持久结构，Agent 可以通过内建 memory tool 自行更新；block 可共享、可设 read-only。[官方 Memory Block 文档](https://docs.letta.com/guides/core-concepts/memory/memory-blocks)

它有长期状态、自编辑上下文和 Agent identity，但不满足本报告对持续自进化的要求：

- 没有根据任务结果生成多个能力候选；
- 没有 Baseline/Candidate 选择；
- 没有证明 memory edit 让能力提高；
- 更新是完整替换，并发时 last-write-wins；官方文档明确要求应用自己处理覆盖风险；
- 没有能力版本 promotion/rollback。

**可借鉴点**是 read-only policy block、共享作用域、状态持久化；不能把 memory growth 当成 evolution evidence。

### 4.15 Canvas Meta-Agent：最接近“持续 harness 优化”的公开实现

Canvas 于 2026 年公开 Meta-Agent。它冻结基础模型，fast loop 修改 prompt、tools、hooks、stop condition、subagents、control flow、token/cost policy；实验性的 slow loop 再修改负责提出改动的 proposer skill。[官方代码与技术说明](https://github.com/canvas-org/meta-agent)

**闭环**

1. 在 search split 运行当前 harness；
2. 保存每任务结果、trace、cost、runtime；
3. 诊断失败并写一个具体 hypothesis；
4. 产生一个或多个 harness Candidate；
5. validate、smoke-test、evaluate；
6. 根据配置 policy 选择下一候选；
7. 可用 selection/holdout 接受，另留 proposer 未见的 final-test。

每个 Candidate 保存 harness、proposal notes、scores、summary、逐任务 trace/events/result，审计性很好。

**长处**

- 把候选和经验落盘，成功与失败都供后续 proposer 使用。
- 明确区分 search、selection、final test，并坦白反复使用 holdout 后它只能算 validation。
- 完整 harness 是一个 Python 文件和稳定 entrypoint，搜索边界清楚。
- slow loop 的目标是让 proposer 不再重复同类失败，是真正的“进化进化器”雏形。

**不足**

- 官方公开结果只覆盖 tau-bench airline 的一个小 split、单次 run；README 明确说未证明 transfer、retention 或抗遗忘。
- selection 数据已经用于选择，结果不是 untouched final-test；作者主动披露了这一限制。
- slow loop 尚未评测是否改善迁移或保留。
- harness 可修改工具和控制流，权限面很大；README 未定义用户审批、secret boundary、live deployment 或自动回滚。
- on-disk candidate lineage 很强，但没有 DSH 式 Session 固定 generation 和在线 active pointer 事务。

**启示**

- Candidate 必须有单一 hypothesis，并保留失败证据；
- search/selection/final-test 三分，反复查看的 held-out 必须降级成 validation；
- 暂不实现“进化 proposer”的 slow loop，先证明 task-facing Skill 的保留与迁移；
- `EvoForge` 的长期护城河不能是“会改 harness”，而是“能在真实常驻 DSH 中可靠发布和撤销能力”。

## 5. 首次设计审计发现的缺陷与处理状态

以下问题来自对早期 [可证明自进化设计](../architecture/evolution-design.zh.md) 的审计，不是泛泛风险。后续文档已经处理了一部分**设计缺口**，当前也只有 P0A.1 safety tracer 的实现证据，仍没有真实改善效果证据；“设计已处理”或“安全门已实现”不得写成“进化问题已解决”。当前权威测试接缝见 [P0A Shadow 契约](../architecture/p0a-shadow-contract.zh.md)，长期声明门见 [Hermes 上位目标验收记分卡](../architecture/hermes-replacement-scorecard.zh.md)。

| 审计项 | 当前处理状态 |
|---|---|
| evaluator、数据分区、随机性与 epoch | P0A 契约已定义；实现与误报/漏报仍待实测 |
| 基础设施先行 | 路线已改为 P0A Shadow 先证明价值，P0B 才建设在线发布 |
| Markdown 权限语义、外部副作用 | 已成为 hard gate；语义检测能力仍待实现 |
| final-test 隔离 | 已定义无工具 proposer、受限 Trial 和 host evaluator；隔离强度仍待攻击测试 |
| 反事实监测、冲突、淘汰 | 保留到 P0B/P1；当前未实现 |
| signal poisoning、隐私、跨 Skill 路由 | 只有原则或局部约束，仍是开放风险 |
| 独特性与宣传边界 | 已收缩为 DSH 原生可信发布闭环，并增加分级验收；尚未获得 paired benchmark 证据 |

### 5.1 最大缺口仍是 evaluator，不是 Candidate 生成

首次审计时，设计详细规定了 Generation、pin、Storage、状态恢复，却没有给出第一个真实 Skill 的：

- 哪些任务进入 train/validation/final-test；
- 谁写 expected behavior；
- 如何判断“漏读规范”“测试没重跑”“diff 不合格”；
- evaluator 自己如何校准误报/漏报；
- model/judge/模型版本改变时如何保持可比性。

公开项目共同证明：有 metric 才有优化；错误 metric 会把 Agent 稳定优化到错误方向。现在 P0A 已固定 `build-dsh-plugin`、三个 deterministic fixture、known-bad/known-correction、报告与 epoch，但在真实 Trial 产生误报/漏报数据前，evaluator 仍是最大未证实风险。

### 5.2 P0B 可能成为无用户价值的基础设施先行

Generation Binder、sidecar pin、active pointer、crash injection 都重要，但 P0B 本身不生成候选、不给出任何改进结果。若在 P0A 证明价值前建设它，仍会落入工程自嗨。当前路线已经把 P0A Shadow 设为 P0B 的硬进入条件。

更小的验证顺序应是：先用离线 Shadow CLI 在一个 Skill + 一个真实 evaluator 上证明“能发现并拒绝坏 Candidate、至少找到一个稳定提升”；只有证明有价值，才把 Candidate 接入 live Generation Binder。

### 5.3 “Markdown 指令”不等于低风险

纯文本 Skill 可以诱导 Agent 读取秘密、调用网络、删除文件、绕开审批或改变外部动作。按文件扩展名区分“指令安全、代码危险”是不充分的。

自动晋升必须检查**能力效果和权限请求差异**，不只是 diff 类型。任何增加工具范围、外部目标、secret 请求、Protected Action 触发率的文本 Candidate 都应进入 review。

### 5.4 retained/final-test 的独立性仍需实现证明

首次审计时只写了“proposer 未见 retained cases”，没有定义：

- proposer 是否能通过仓库或 Trial 工具读取它；
- evaluator 是否与 proposer 使用相同模型/提示，形成相关偏差；
- repeated promotion 是否已经间接泄露 case；
- 何时把反复使用的 retained 降级为 validation，并补充新的 final-test。

P0A 契约现已采用 search / selection / final-test 分层，并要求无工具 proposer、受限 Trial workspace 与 host 侧 evaluator。真正的剩余问题是实现能否阻止路径逃逸、间接泄漏和重复试验后的 case 污染。

### 5.5 随机性和统计门槛尚未校准

P0A 契约已经要求随机 case 预声明最小复跑数、paired 配置和 tie policy，epoch 变化后不得累计旧分数，但没有真实数据可以确定各类 case 的合理重复次数或 margin。一次 Baseline 失败、Candidate 成功仍可能只是采样噪声。

实现必须从 case pack 读取这些预声明参数并把实际复跑数写入报告；证据不足一律 review/reject，而不是自动 promote。具体数值只能由 P0A 数据校准，不能在设计文档中拍脑袋设定。

### 5.6 线上 Monitor 缺少反事实

晋升后看到一次失败，并不能证明旧版本会成功；看到没有投诉，也不能证明新版本更好。当前“同一 deterministic failure 再次出现就立即回滚”可能把外部环境变化误判为能力回归。

更可靠的做法是保存可重放输入，在隔离环境补跑 parent/candidate；只有 parent 通过、candidate 失败或 hard safety gate 失败才自动回滚。无法重放时进入异步 review。

### 5.7 自动回滚不能撤销外部副作用

Git tree 和 active pointer 可以回滚 Skill，但已经发送的消息、创建的日程、付费、部署、数据删除不能回滚。版本可逆不等于世界状态可逆。

因此所有外部副作用仍需原生 Protected Action/明确策略；进化插件不能因为“支持 rollback”扩大授权。

### 5.8 signal 污染与 prompt injection 尚未建模

会话、issue、仓库文本、消息内容都可能诱导 Agent 把恶意指令沉淀成 Skill。仅保存引用和 fingerprint 不解决 poisoning。

需要：只接受受信来源的 explicit correction；外部内容永不直接成为 instruction；Candidate 生成时标注 provenance；涉及权限、秘密、网络域名的新增语义强制 review。

### 5.9 多 Skill 与路由交互未解决

一个 Skill 的效果依赖 description routing、其他 Skill、工具描述和 system prompt。当前 paired Trial 要求只改变一个 Skill body，虽然利于归因，却可能测试不到真实调用概率；修改 description 又会破坏稳定前缀和 cache。

P0 应把“Skill 被正确触发”和“Skill 触发后的执行质量”拆成两个 evaluator，前者只做离线 routing test，后者保持 description 不变。

### 5.10 Candidate 冲突、合并和淘汰未定义

两个并发 Candidate 修改同一个 Skill、两个各自有效改动组合后冲突、旧 Generation 长期占盘、Skill 越来越多等问题尚无策略。Hermes Curator 已证明 Skill garden 会膨胀，GEPA/ADAS 也使用 archive 而非单一路径。

P0 不需要复杂 merge engine，但至少要规定：同一 artifact 同时只允许一个 testing Candidate；后来的基于最新 generation rebase/regenerate；失败/过期 Candidate 自动归档；保留最近 N 个可回滚 Generation。

### 5.11 隐私和数据保留规则不够具体

“默认不复制 transcript”是好原则，但 Trial 必须读取输入、输出、代码和反馈。尚未定义 secret redaction、保留期限、跨项目隔离、用户删除、Draft PR 中哪些证据可以上传。

默认应只在本机保存最小重放 fixture；任何向外部模型发送历史片段前沿用 DSH 权限和 secret scanner；PR 只放指标和脱敏 diff，不放原会话。

### 5.12 独特性不足

当前“真实轨迹 → Candidate → held-out → Git → PR”的核心，与 Hermes Self-Evolution 和 Canvas Meta-Agent 高度重叠。若只是重新实现 GEPA runner，开源价值有限。

必须把独特主张收缩为公开项目尚未完整解决的组合：

1. DSH 原生插件，非 fork、非第二套 Agent framework；
2. 正常会话零常驻工具、零动态前缀，KV Cache 是全局硬约束；
3. live Session immutable Generation，resume/fork/subagent 继承；
4. 明确胜出的安全指令只对未来 Session 非阻塞晋升；
5. active pointer 崩溃一致性和线上 counterfactual rollback；
6. DSH Goal + 软件交付结果成为第一个客观 adapter；
7. 候选搜索保持私有可替换：先用最小 proposer，只有同一 evaluator 证明 GEPA 有净收益时才接入，不把搜索算法绑死在产品里。

## 6. 人工介入到底多不多

### 6.1 按当前设计，P0 阶段人工介入偏多

当前路线中的 P0C 是 Human promotion，P1 才开放有限自动晋升。因此在 P0：

- Candidate 生成、静态检查、Trial、reject 可以自动；
- 所有真正生效的 Candidate 都需要人 `/evolve promote`；
- executable/plugin/tool/permission 变化始终只到 commit/Draft PR，需要人工决定；
- merge、release、生产部署、秘密、付费、不可逆动作始终需人工或明确策略批准。

这在验证期合理，但若长期保持，会变成“自动生成审批工单”，而不是自进化。

### 6.2 成熟模式应只在四类情况找人

| 环节 | 是否需要人工 | 原因 |
|---|---|---|
| 初次启用、声明 owned Skill、预算和允许的 project scope | 一次性需要 | 这是授权，不应推断 |
| 明确 deterministic win、纯指令、权限效果不变、retained/final-test 通过 | 不需要 | 可只对未来 Session 自动晋升并保留回滚 |
| 主观质量、样本少、指标冲突、scope 扩大 | 异步需要 | 价值判断无法可靠自动化 |
| 插件代码、脚本、工具 schema、权限或外部动作变化 | 需要 | 风险面扩大；只产 Draft PR |
| hard gate 失败、无提升、超预算 | 不需要 | 自动 reject，不应打扰用户 |
| 可重放证据证明新版本回归 | 不需要 | 自动回滚；随后给摘要即可 |
| 无法建立反事实的疑似线上回归 | 异步需要 | 防止误回滚和版本振荡 |

### 6.3 目前不能诚实承诺“人工只占多少百分比”

公开项目没有提供可迁移到 DSH 用户分布的 approval rate，当前设计也没有真实 Candidate 数据。任何“80% 自动”之类数字都是拍脑袋。

应该将首个 Shadow 试验的产品指标设为：

- `auto_reject_rate`：多少坏候选被机器静默淘汰；
- `clear_win_rate`：多少候选满足未来可自动晋升标准；
- `review_rate`：多少进入人类 inbox；
- `review_accept_rate` 与 `median_review_seconds`；
- `false_promotion`、`false_rollback`；
- 每减少一次真实返工所消耗的 token/人民币。

只有测到这些数据，才能决定自动化是否真的减少人工。

### 6.4 防止审批队列反过来打扰用户

- 原会话永不等待 review；
- review 只聚合摘要，不一候选一通知；
- 同一 Skill 同时最多一个待审 Candidate；
- 低价值/过期/证据不足候选自动关闭；
- 不回复 review 不影响正常 DSH 使用；
- 提供 pause、budget cap、只在用户主动 `/evolve review` 时查看的静默模式。

## 7. 修订后的最小实现路线

### P0A：先证明评测，不先建设完整发布平台

交付一个离线、只读 active Skill 的 `dsh-evolve shadow <skill-dir>`：

- 一个软件开发 Skill；
- 3–5 个 deterministic reproduction cases；
- 独立 selection 与 unopened final-test；
- 一个最简单的 patch proposer，可选 GEPA adapter；
- 自动生成 Baseline/Candidate 报告，但绝不激活。

退出条件：能稳定拒绝人为构造的坏 Candidate，并至少发现一个跨 final-test 的真实改进。做不到就停止，而不是加更多基础设施。

### P0B：建立 release safety

在 P0A 有价值后再实现：

- immutable Generation；
- Session pin；
- future-session-only promotion；
- active pointer 原子切换；
- crash recovery 与精确 rollback；
- KV Cache composition fingerprint。

### P0C：人工晋升、异步 inbox

把 Shadow 结果接到 `/evolve review/promote/rollback`。所有 review 在旁路进行，不阻塞产生信号的会话。

### P1：只开放窄自动晋升

仅允许：project-scoped、owned、纯指令、权限效果不变、deterministic clear win、selection/final-test 无回归、rollback rehearsal 成功。先小比例 future-session canary，再全量切 active pointer。

### P2：只在真实变化出现后提取 Adapter

- 简单 proposer 不足且 GEPA 在同一 evaluator 上有净收益时，先作为 Evolve 私有 Adapter；第二个真实 optimizer 出现后才形成公共 Interface；
- Software Delivery 可以因独立用户结果成为插件，但它与 Evolve 的 outcome seam 在第二个真实 outcome 出现前保持私有；
- release/runtime 保持一个深模块，不把内部 Observer/Runner/Promoter 拆成十几个浅插件。

## 8. 应借鉴与应拒绝的设计

### 直接借鉴

- Voyager：environment/error/verifier 多源反馈，Skill 可组合；
- Reflexion：把轨迹压缩成可行动的失败解释；
- Self-Refine：小范围 feedback/refine 原语；
- DGM/ADAS：保留祖先和失败谱系，不覆盖唯一当前版本；
- AFlow：受约束 mutation operator，减少开放代码搜索；
- GEPA：轨迹反思、Pareto 候选、rich textual feedback；
- Hermes：异步 pending、Skill provenance、Curator、progressive disclosure；
- Hermes Self-Evolution：dataset 分层、尺寸/cache/benchmark/PR gate；
- Canvas Meta-Agent：单一 hypothesis、完整经验目录、search/selection/final-test 分离。

### 明确拒绝

- 反思后直接改 active Skill；
- 同一个模型既提议又批准；
- 使用次数等同质量；
- 一次当前任务成功即全局晋升；
- 任意 Python 自改作为 P0；
- 把 Memory 增长宣传成能力进化；
- 反复使用“held-out”进行选择仍称其为未见测试；
- 以文件为 Markdown 为由放宽权限审查；
- 为了自进化复制 DSH 的 Goal、Session、Storage、Approval 或 daemon。

## 9. 最终判断

公开市场已经有大量“会反思”“会改 prompt”“会搜索 workflow”的项目，也已经有与当前方案高度相似的 Hermes 官方 self-evolution 和 Canvas Meta-Agent。EvoForge 若只做候选生成和 benchmark，不足以构成独特开源价值。

真正仍未被这些项目完整解决、又与 DSH 优势天然一致的问题是：

> 如何让一个单机常驻、正在处理真实工作且拥有工具权限的 Agent，在不改变当前 Session、不破坏 KV Cache、不扩大授权、不阻塞用户的前提下，把经过独立证据证明的能力版本安全地交付给未来 Session，并在崩溃或真实回归后精确恢复。

这应成为 `dsh-evolve` 的唯一核心。候选生成算法可以复用，可信发布闭环才是产品。

## 10. 一手来源索引

- Hermes Agent：[GitHub](https://github.com/NousResearch/hermes-agent) · [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) · [Curator](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator)
- Hermes Agent Self-Evolution：[GitHub](https://github.com/NousResearch/hermes-agent-self-evolution) · [PLAN](https://github.com/NousResearch/hermes-agent-self-evolution/blob/main/PLAN.md)
- Voyager：[论文](https://arxiv.org/abs/2305.16291) · [GitHub](https://github.com/MineDojo/Voyager) · [FAQ](https://github.com/MineDojo/Voyager/blob/main/FAQ.md)
- Reflexion：[论文](https://arxiv.org/abs/2303.11366) · [GitHub](https://github.com/noahshinn/reflexion)
- Self-Refine：[论文](https://arxiv.org/abs/2303.17651) · [项目页](https://selfrefine.info/)
- Darwin Gödel Machine：[论文](https://arxiv.org/abs/2505.22954) · [GitHub](https://github.com/jennyzzt/dgm) · [Sakana AI](https://sakana.ai/dgm/)
- ADAS：[论文](https://arxiv.org/abs/2408.08435) · [GitHub](https://github.com/ShengranHu/ADAS)
- AFlow：[论文](https://arxiv.org/abs/2410.10762) · [GitHub](https://github.com/FoundationAgents/AFlow)
- Agent0：[论文](https://arxiv.org/abs/2511.16043) · [GitHub](https://github.com/aiming-lab/Agent0)
- EvoAgentX：[论文](https://arxiv.org/abs/2507.03616) · [GitHub](https://github.com/EvoAgentX/EvoAgentX) · [HITL](https://evoagentx.github.io/EvoAgentX/tutorial/hitl.html)
- DSPy/GEPA：[DSPy Optimizers](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md) · [GEPA 论文](https://arxiv.org/abs/2507.19457) · [GEPA GitHub](https://github.com/gepa-ai/gepa)
- TextGrad：[论文](https://arxiv.org/abs/2406.07496) · [GitHub](https://github.com/zou-group/textgrad)
- LangMem：[GitHub](https://github.com/langchain-ai/langmem) · [Prompt Optimization API](https://langchain-ai.github.io/langmem/reference/prompt_optimization/)
- Letta：[Memory Blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks) · [官方 GitHub](https://github.com/letta-ai/letta)
- Canvas Meta-Agent：[GitHub 与技术说明](https://github.com/canvas-org/meta-agent)
