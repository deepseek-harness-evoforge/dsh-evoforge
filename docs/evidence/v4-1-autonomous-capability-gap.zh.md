# V4-1 自主 Capability Gap 纵切证据

> 状态：implemented evidence
> 日期：2026-08-18
> 边界：证明 DSH 原生自然语言 Goal 到可追踪 Gap 与隔离发现的第一条纵切；不证明完整自主 Skill 获取、生成或长期进化。

## 用户结果

用户只提交自然语言 Goal，不需要在开场选择任务类型、Agent、工作流、路径或 Skill。已有能力仍由模型
根据 DSH 原生 Session Skill catalog 的名称和描述自主选择，并通过原生 `skill` Tool 按需加载。模型检查
完整目录后确认没有适用 Skill 时，可以调用一个固定 Tool：

```json
{"name":"report_capability_gap","arguments":{"name":"publish-dsh-plugin"}}
```

该调用不是安装命令。Host 接受后会记录一个可复核 Gap，当前 Session 继续正常运行；后台只在部署者
显式授信范围内搜索，候选始终 inactive、quarantined、never-executed。

## 权威链路

1. `CapabilityMap` 在可见 DSH `skills` 服务的注入生命周期内，于真实 `agent/pre-step` 读取 exact
   Workspace + Session catalog；provider 未 settled 时保持 incomplete，不允许据此确认缺口。
2. `report_capability_gap(name)` 只接受长度不超过 128 的 DSH kebab-case Skill name。
3. Host 重新核对 native Agent、Workspace/Session identity、active native Goal、完整 catalog/hash，以及
   exact name 当前不存在；模型的自述本身不是证据。
4. `CapabilityGapStore` 先持久化 `model-declared-skill-gap`、Goal revision 与 catalog evidence，再返回回执并
   非阻塞唤醒 trusted discovery。调度器同步抛错或异步拒绝不能撤销已持久化回执。
5. 发现循环只读取显式配置的本地 Git checkout/mirror。V4-1 首先证明 exact-name 固定 commit、tree hash、
   content hash 与 whole-Skill package metadata；其后的 exact-first 确定性语义回退见
   [V4-2](v4-2-trusted-semantic-skill-search.zh.md)。
6. 已接通的 deterministic admission 与独立 assembled holdout Shadow 都不给候选 release authority；清晰
   胜出也只形成 inactive human-review Candidate，晋升只可能影响未来 Session。
7. `dsh-evolve-web` 复用同一权威 control service 展示 Capability Map、Gap queue、Goal、catalog evidence、
   Skill 候选、来源、权限与 inactive 状态，不调用模型，也不提供选路、安装或静默激活按钮。

## 可复核实现

- Tool 与 Host 门禁：`packages/dsh-evolve/src/capability-gap-tool.ts`
- catalog 生命周期：`packages/dsh-evolve/src/capability-map.ts`、`packages/dsh-evolve/src/index.ts`
- durable evidence：`packages/dsh-evolve/src/capability-gap-store.ts`
- trusted discovery/quarantine：`packages/dsh-evolve/src/trusted-skill-discovery.ts`
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

- Tool 不搜索网络；后台目前仅支持显式授信本地 Git 源的 exact-first 查询与确定性词法语义回退，不支持
  市场/官方资料/论文/开源 catalog 的网络搜索或获取。
- 找不到现成 whole-Skill 时尚不能自主生成或组合新 Skill，也没有跨 Goal gap 聚类调度。
- 固定 Adapter 证明原生 Agent Loop 组合，不证明真实模型总能判断“无适用 Skill”、提出正确名称或避免
  误报；需要真实模型正例、已有近似 Skill 负例与对抗 Goal 的 paired benchmark。
- 现有 admission/Shadow 证明候选不能直接激活，不等于已经有足够长期 transfer、retention、
  negative-transfer、false-promotion 或成本证据。
- 因此本纵切是 V4 的 partial implementation，不能支持“完整自我进化”或“Hermes 全面上位替代”声明。
