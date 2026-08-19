# V4-1 自主 Capability Gap 纵切证据

> 状态：implemented evidence
> 日期：2026-08-18
> 边界：证明 DSH 原生自然语言 Goal 到可追踪 Gap 与内部 Skill Opportunity 的第一条纵切；不证明完整候选生成、评测或长期进化。

## 用户结果

用户只提交自然语言 Goal，不需要在开场选择任务类型、Agent、工作流、路径或 Skill。已有能力仍由模型
根据 DSH 原生 Session Skill catalog 的名称和描述自主选择，并通过原生 `skill` Tool 按需加载。模型检查
完整目录后确认没有适用 Skill 时，可以调用一个固定 Tool：

```json
{"name":"report_capability_gap","arguments":{"name":"publish-dsh-plugin"}}
```

该调用不是安装命令。Host 接受后会记录一个可复核 Gap，当前 Session 继续正常运行；后台只从同一
Workspace 的 DSH-owned Goal 经验归纳 Skill Opportunity，不搜索、获取、下载、导入或安装外部 Skill。

## 权威链路

1. `CapabilityMap` 在可见 DSH `skills` 服务的注入生命周期内，于真实 `agent/pre-step` 读取 exact
   Workspace + Session catalog；provider 未 settled 时保持 incomplete，不允许据此确认缺口。
2. `report_capability_gap(name)` 只接受长度不超过 128 的 DSH kebab-case Skill name。
3. Host 重新核对 native Agent、Workspace/Session identity、active native Goal、完整 catalog/hash，以及
   exact name 当前不存在；模型的自述本身不是证据。
4. `CapabilityGapStore` 先持久化 `model-declared-skill-gap`、Goal revision 与 catalog evidence，再返回回执并
   非阻塞唤醒内部 Opportunity reconciliation。调度器同步抛错或异步拒绝不能撤销已持久化回执。
5. `ExperienceDrivenSkillOpportunityDiscovery` 只读取 durable Goal-linked Gap；同 Workspace、同 Skill 且
   至少两个不同 Goal 才形成 Opportunity，同 Goal retry 和证据不足 abstain。
6. 内部 Candidate 的 deterministic admission 与独立 assembled holdout Shadow 都不给候选 release authority；清晰
   胜出也只形成 inactive human-review Candidate，晋升只可能影响未来 Session。
7. `dsh-evolve-web` 复用同一权威 control service 展示 Capability Map、Gap queue、Goal、catalog evidence、
   Skill Opportunity、Candidate 内部谱系、权限与 inactive 状态，不调用模型，也不提供选路、安装或静默激活按钮。

## 可复核实现

- Tool 与 Host 门禁：`packages/dsh-evolve/src/capability-gap-tool.ts`
- catalog 生命周期：`packages/dsh-evolve/src/capability-map.ts`、`packages/dsh-evolve/src/index.ts`
- durable evidence：`packages/dsh-evolve/src/capability-gap-store.ts`
- 内部 Opportunity：`packages/dsh-evolve/src/skill-opportunity-discovery.ts`
- Candidate quarantine：`packages/dsh-evolve/src/skill-candidate-repository.ts`
- 控制面投影：`packages/dsh-evolve/src/evolution-control-plane.ts`
- Web Gap queue：`packages/dsh-evolve-web/src/client/EvolutionAction.tsx`

自动化证据包括：

- 公共 DSH Tool Runtime 执行成功、已有 Skill/incomplete catalog/超长 name fail closed、先落盘后调度；
- 真实 DSH StorageDomain 对两种合法 evidence provenance 的恢复，以及非法 kind/routing 混搭拒绝；
- 真实 DSH Agent Loop 在 active Goal 中执行 Tool call，再把成功 Tool result 送回第二轮，并从权威控制面
  读取同一 Goal revision 与 `model-declared-no-applicable-skill`；该测试同时发现并修复了 observer 未进入
  可见 `skills` 注入作用域时 catalog 永远 `unobserved` 的真实组合缺陷；
- 64 轮真实 provider request 中 Tool 名称、描述、Schema 与顺序稳定，第 33 轮 future Generation 变化不
  影响当前 Session；删除这一项后其余请求与无 EvoForge 控制组逐项、逐字节相同；
- 整体 `dsh-evolve` 单元/集成测试、类型检查及根级检查作为提交门禁。

## 没有被证明的内容

- 旧 trusted-local、Agent Skills 与 runtime research 路径已经撤销并删除；本证据不支持任何运行时能力获取声明。
- 当前至少两个 Goal-linked Gap 可驱动受预算约束的内部 whole-Skill author，见 [V4-8](v4-8-internal-skill-opportunity-discovery.zh.md) 与 [V4-9](v4-9-internal-skill-candidate-boundary.zh.md)；完整 correction/outcome/cost/reuse/retention 归因仍未实现。
- 固定 Adapter 证明原生 Agent Loop 组合，不证明真实模型总能判断“无适用 Skill”、提出正确名称或避免
  误报；需要真实模型正例、已有近似 Skill 负例与对抗 Goal 的 paired benchmark。
- 现有 admission/Shadow 证明候选不能直接激活，不等于已经有足够长期 transfer、retention、
  negative-transfer、false-promotion 或成本证据。
- 因此本纵切是 V4 的 partial implementation，不能支持“完整自我进化”或“Hermes 全面上位替代”声明。
