# ADR-0048：自我发现只从 DSH 自身经验学习

- 状态：accepted
- 日期：2026-08-18
- 取代：[ADR-0046](0046-autonomous-skill-discovery-uses-three-planes-and-two-speeds.md) 中的运行时外部发现部分

## 背景

用户只向 DSH 提交自然语言 Goal。自我发现的产品价值是系统从自己的 Goal、失败、纠正、真实结果、
重复工作、复用与保留效果中发现“下一项值得沉淀或改进的能力”，而不是后台替用户搜索市场或包索引。
把 ClawHub、Agent Skills、GitHub、文档或市场搜索称为自我发现，会混淆学习证据、供应链信任和产品入口，
也会重新要求部署者预选 Skill、来源或路径。

## 决定

1. 运行时自我发现只消费 DSH 内部、Workspace-scoped、Goal-linked 的 durable 证据。
2. 同一 Workspace、同一 Skill 至少两个独立 Goal 的 Capability Gap 才形成 `SkillOpportunity`；同 Goal
   retry、无 Goal、跨 Workspace 和证据不足均 abstain。
3. `selfDiscoveryPolicies` 只配置 policy id、Workspace、私有 run root 和 UTC 日预算；不接受 Skill、路径、
   来源、Agent、workflow 或 route。
4. author 只接收有界 Goal/Gap 证据，输出 instruction-only whole-Skill；Host 负责身份、路径、大小、文件类型、
   内容哈希和隔离校验。结果固定为 inactive/quarantined/unevaluated/never-executed，发布权为 none。
5. DSH Web 展示 Gap → Opportunity → Candidate、成本和治理状态，不展示外部搜索尝试。
6. 外部生态、Hermes、OpenClaw、HanaAgent、论文和开源实现仅用于设计期研究与冻结 benchmark。未来若
   支持外部包，必须作为独立、显式授权的 trusted-import 能力，不得复用“自我发现”名称或状态机。
7. 三平面、双速、当前 Session 不漂移、独立评测与 future-session-only 晋升原则继续有效。

## 结果

- 用户只需表达 Goal，系统不在开场要求选择路径或 Skill；
- Skill 方向由真实重复需求推导，policy 不再偷渡产品路线；
- 外部供应链与内部学习证据分离，Web 和文档可准确解释发生了什么；
- 生成 Candidate 不等于效果改善，仍需独立 final-test、Shadow、Retention 与长期 outcome；
- 历史外部发现/研究记录可保留作迁移或审计，但不再进入公共配置、运行时编排或当前能力声明。

## 拒绝方案

- 运行时搜索 ClawHub/市场并称为自我发现；
- 由部署者配置 exact Skill author target；
- 单个 Goal 重试累积成“跨任务证据”；
- author 同时生成验证答案并自行晋升；
- Candidate 直接安装、激活或改变当前 Session。
