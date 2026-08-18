# V4-2 可信本地 Skill 确定性语义发现证据

> 状态：implemented evidence
> 日期：2026-08-18
> 边界：证明 accepted Capability Gap 可在显式授信的本地 Git Skill catalog 中从 exact 查询安全回退到有界、确定性的词法语义发现；不证明网络来源搜索、Skill 生成或完整 V4 退出门。

## 用户结果

用户仍然只提交自然语言 Goal，不需要在开场选择路径、Agent、工作流或 Skill。模型提出的 Gap 名称与可信
catalog 中的实际 Skill 名称不完全相同时，EvoForge 可以结合 Gap 名称和 active Goal objective 找到唯一、
证据足够的近似 whole-Skill。例如 `publish-dsh-plugin` 可以映射到 `release-native-extension`，而不是要求
模型预先猜中目录名。

该匹配不会安装或激活 Skill。候选仍是 `quarantined`、`inactive`、`unevaluated`、`never-executed`，后续只能
进入既有确定性 admission、独立 holdout Shadow 和人工 review 链路。

## 决策顺序与 fail-closed 规则

1. 每个来源必须是部署者显式配置的既有本地 Git checkout/mirror；查询固定在当次 `HEAD` commit。
2. exact Skill path 永远优先。如果 exact path 存在但 package 身份、frontmatter 或内容非法，本次来源记录
   `invalid-skill-package`，不得用另一个近似 Skill 绕过身份错误。
3. 只有 exact path 不存在且 Gap 携带 active Goal 证据时，才读取同一 revision 的 catalog header。
4. 一次有界 `git ls-tree` 最多接受 512 个直接位于 `skillsRoot/<name>/SKILL.md` 的普通 `100644` header；
   单个 header 最大 64 KiB。非法 catalog entry 被排除，但不能污染其他合法 package。
5. 查询只使用 Gap proposed name 与 Goal objective；候选只使用 frontmatter name/description。文本经 NFKC、
   小写、有限英文词尾归一化和通用停用词过滤；连续中文使用二元字组，使中文自然语言 Goal 不依赖模型翻译。
6. Gap 名称命中权重高于 Goal 背景，候选 name 命中权重高于 description。原始分数至少为 8，并且必须
   命中至少一个 Gap 词或两个 Goal 词；否则记录 `no-semantic-match`。
7. 次名也具备资格时，首名分数必须达到次名的 125%；否则记录 `ambiguous-semantic-match`。并列不会靠
   字典序静默获胜。
8. 唯一合格结果固定 commit、tree hash、content hash 与 whole-Skill package metadata；`match` 额外保存
   原始 Gap name、算法版本、首名/次名原始分数及绑定 Goal id/revision/objective 的 query hash。

这一分数只是可重放的词法证据，不是概率或模型置信度。搜索过程没有 provider/model 调用，也不读取网络。

## Web 可解释性

`dsh-evolve-web` 的 Skills 视图同时显示：

- 实际发现的 Skill 名称和描述；
- `原始 Gap → 实际 Skill` 映射；
- “词法证据分数（非置信度）”与次名分数；
- trusted local Git、固定 revision/hash、whole-Skill package 信息；
- quarantine、inactive、never-executed、unevaluated 状态。

视图没有 Install/Activate 按钮，也不会触发模型调用。真实 in-app Browser 对实际 `EvolutionAction` 浏览器
fixture 完成可见性验收：映射和 `18 / runner-up 0` 分数可见，四项隔离状态可见，Install/Activate 按钮
计数为 0，console warning/error 为 0。该次验收验证的是实际 React 组件与浏览器渲染；完整 DSH Host/Client
Module 的安装与挂载仍由既有 P0C-6 clean-profile 浏览器证据覆盖，不把 fixture 伪装成新的整机安装证据。

## 自动化证据

`trusted-skill-discovery.test.ts` 覆盖：

- exact miss 后选择唯一强匹配，并从 pinned Git objects 重建完整 Skill；
- 中文 Goal objective 在不调用模型的情况下选择中文描述候选；
- 两个同强候选时歧义 abstain；
- 弱相关 catalog 时无匹配 abstain；
- 非法 exact package 存在时不允许语义候选绕过；
- exact 合法 package 保持优先且不伪造 semantic `match`。

`capability-gap-store.e2e.test.ts` 使用真实 DSH StorageDomain 证明 semantic match、歧义 attempt 与 source status
可持久恢复；`evolution-control-plane.test.ts` 证明 `match` 被权威投影；`evolution-action.client.test.tsx` 证明
Web 文案和映射可见。提交门还包括两个 package 全量测试、Typert 生成、Cache Contract 与根级 `pnpm check`。

## 尚未证明

- 本 slice 未搜索网络；后续 [V4-4](v4-4-agent-skills-index-discovery.zh.md) 已加入显式授信 Agent Skills v0.2
  单文件制品获取，但任意市场/官方资料/论文/GitHub 搜索与来源信誉仍未建立。
- 该算法是保守的确定性词法语义检索，不是 embedding、LLM rerank 或完整语义理解；它会主动漏掉证据不足
  的候选，以避免静默误选。
- 没有现成 whole-Skill 时仍不能自主生成或组合新 Skill。
- 跨 Goal Gap 已能形成 evidence-only 需求聚类，但尚未完成 cluster-driven 慢环调度、真实模型正负路由
  质量与迁移/遗忘长期数据，详见 [V4-3](v4-3-cross-goal-gap-demand.zh.md)。
- 尚未完成同模型、同任务、同权限、同预算下与固定 Hermes revision 的完整 paired outcome。

因此 V4-2 只关闭“模型必须猜中本地可信 Skill exact name”这一窄缺口，不能支持“完整自我进化已完成”或
“已经全面上位替代 Hermes”的声明。
