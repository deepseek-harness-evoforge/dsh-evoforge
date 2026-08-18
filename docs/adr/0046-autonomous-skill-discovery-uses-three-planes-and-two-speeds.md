# ADR-0046：自主 Skill 发现采用三平面双速闭环

- 状态：accepted
- 日期：2026-08-18

## 背景

用户希望只给出自然语言 Goal、材料、约束与验收条件，由系统自己发现和调用 Skill；开场要求用户选择
任务类别、Agent、工作流或 Skill 会把系统内部路由责任转嫁给用户。Hermes 已提供 Skill 创建和后台
复盘，OpenClaw 提供隔离 reviewer、hash、quarantine 与 rollback，前沿实现进一步证明 whole-Skill
候选、held-out validation、跨任务迁移和 archive 有价值，但任何单一方案都不足以证明长期变好。

## 决定

DSH Goal 仍是唯一公开输入。`dsh-evolve` 在 host plane 维护可解释的 Capability Map，并先自主选择当前
Workspace 中适用、已验证的能力；没有适用能力时才记录 Capability Gap，并在部署者显式信任的本地、
市场、官方资料与开源来源中发现或生成 inactive whole-Skill Candidate。外部候选必须固定 identity、
source、scope、version、content hash、权限和安全状态，不能静默安装到活动 Session。

闭环分为三个权力平面：稳定执行面拥有当前 Goal/Session；隔离进化面生成 Candidate；独立 Evaluation
Governance Plane 拥有 evaluator、holdout、gold、hard gates 与 release eligibility，Candidate 不得读写。
在线 Fast Evolution Loop 只记录可归因 signal/gap 和小步候选；离线 Slow Evolution Loop 聚类跨任务
证据，搜索或组合完整 Skill 包，执行 baseline/candidate、holdout、回归、迁移、安全、成本、时延和
cache 评测，再 promote/review/reject/abstain。晋升只影响未来 Session。

## 当前实现接缝

已有能力的语义选择继续由 DSH 原生 Session Skill catalog 与 `skill` Tool 承担，EvoForge 不建立路由菜单
或第二个 Skill registry。为了让“目录里没有适用能力”成为可追踪事件，`dsh-evolve` 只增加一个稳定的
模型 Tool：`report_capability_gap(name)`。模型只能在读过完整目录且没有 Skill 适用时调用；Host 会再次
验证 exact Workspace/Session、active native Goal、settled catalog、name 长度/语法及 exact name 缺失，
以 `model-declared-skill-gap` 区分于原生 `skill` 的 `native-skill-miss`，并先持久化再非阻塞唤醒发现循环。
调度失败不能撤销已经成立的 Gap 回执。

该 Tool 只报告缺口，不接收用户选路，不读取网络，不生成、执行、安装或激活候选。它是 Cache Contract
中明确列出的单一稳定增量；当前 Session 内名称、描述、Schema 与顺序不随发现、评测或 future
Generation 变化。现阶段发现支持部署者明确授信的本地 Git 源：exact 查询优先，exact 不存在时可在同一
固定 revision 上对合法 Skill name/description 做有界、确定性的词法语义回退；弱匹配、歧义和非法 exact
package 均 fail closed。Host 还会从 durable Gap 与隔离候选身份派生同一 Workspace、至少两个不同 Goal 的
重复需求聚类；同一 Goal 的 retry 不构成跨 Goal 证据，有冲突候选的 Gap 不进入聚类。聚类只有慢环优先级
证据权，不会触发生成、安装、激活或发布。外部来源搜索/获取、候选生成、cluster-driven 调度和真实模型
路由质量仍是后续门禁，不能从本实现推断已经完成整个 ADR。

## 结果

- 用户不需要预先理解 Skill 目录或工作流分类；Web 可解释实际路由和未满足缺口；
- 一次成功、模型自评、重试、使用次数或 scanner 通过不能直接发布；证据不足时允许 abstain；
- 快环保持前台非阻塞，慢环可以积累跨任务证据而不污染当前 Session composition；
- Skill folder 作为原子候选进入内容寻址谱系，可精确比较、隔离、晋升和回滚；
- discovery 先作为 `dsh-evolve` 深模块实现；只有独立生命周期、信任边界或第二消费者出现才拆包。

## 拒绝方案

- 开场菜单或让用户手选 Skill：暴露内部路由复杂度，无法实现自主发现；
- Hermes 式前台保存方法后直接复用：缺少独立反事实与未见样本证据；
- scanner/reviewer 通过后直接写 live Skill：安全检查不等于效果验证；
- 一个后台循环同时生成、评分和发布：候选可影响裁判，无法建立可信晋升证据；
- 每次失败都生成新 Skill：会放大误路由、权限或配置问题并造成能力污染。
