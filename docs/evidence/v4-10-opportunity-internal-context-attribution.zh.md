# V4-10 Skill Opportunity 内部上下文归因证据

> 声明等级：`implemented`，不是 `verified/released`。本文证明 Opportunity 能保守关联 DSH 自己持久化的明确纠正引用和真实交付结果；它不证明这些结果由缺失 Skill 导致，也不证明完整自我进化。

## 当前数据流

```text
Host-confirmed Goal-linked Capability Gap × 至少两个不同 Goal
  → eligible Skill Opportunity
  ├─ same Workspace + same Session + Session 内唯一 Gap Skill + event after Gap
  │    → reference-only explicit correction context
  └─ same Workspace + exact Goal id/revision + revision 内唯一 Gap Skill + event after Gap
       → passed / failed / unknown delivery outcome context
```

`ExperienceDrivenSkillOpportunityDiscovery` 现在直接读取三个 DSH Storage Domain：Capability Gap、`negative + non-blank note` 的 reference-only Feedback Signal、`complete_delivery` 的 compact Outcome。Opportunity schema v2 保存：

- 资格 Gap/Goal、稳定 Workspace+Skill identity；
- 最多 100 个纠正 Signal id 和 100 个 Outcome id，以及未截断的总数和结果分类计数；
- 明确的 association kind 和固定 `causalClaim: none`。

它不保存 note、消息正文、Session id、Goal objective、commit、PR、路径、日志或 transcript。Web 只展示计数、短 id 和归因免责声明。

## Fail-closed 边界

- 一个 Session 出现第二种 Gap Skill，即使第二条 Gap 没有 Goal，也不把该 Session 的纠正关联到任何 Opportunity；
- 一个 Goal revision 出现第二种 Gap Skill，不关联该 revision 的交付结果；
- 早于首条对应 Gap 的纠正或 Outcome 不关联；
- 同 Goal retry、纠正数量、Outcome 数量或一次成功不能替代“两个不同 Goal”的资格门，也不参与 Opportunity 排序；
- 上下文不进入 bounded author 输入，不给 Candidate、Admission、Shadow、Promotion 或 release 增加权限。

## 自动化证据

- `skill-opportunity-discovery.test.ts` 覆盖跨 Goal 资格、同 Goal abstain、Workspace 隔离、精确关联、时间顺序、Session/Goal Skill 歧义和上下文不得替代资格；
- `capability-gap-store.e2e.test.ts` 在固定 DSH StorageDomain 上写入 Gap、Feedback Signal 和 Delivery Outcome，重启后恢复同一 Opportunity v2 证据；
- `evolution-control-plane.test.ts` 证明 Web contract 只投影有界引用和 `causalClaim: none`；
- `dsh-evolve-web` 组件测试验证关联计数、短引用和“无因果/无资格影响”说明。

固定 DSH 源码 `47f943859bef60e4160492346772ded9b24f765a` 上的当前门禁结果：

- `dsh-evolve` typecheck 通过；全量 Vitest 为 55 files、251 tests 通过、2 skipped、0 failed；
- 真实 DSH StorageDomain 的 `capability-gap-store.e2e.test.ts` 为 5 tests 通过，其中 Opportunity context 在 Host dispose/boot 后精确恢复；
- `dsh-evolve-web` typecheck 通过；2 files、25 tests 通过；
- 根级 typecheck/build 覆盖 11 个用户包并通过，docs checker 通过；
- 十一包 native contract 为 22 tests 通过；clean-profile 最终 tarball add/dump/boot、真实 Session/Goal/Storage、dispose/remove/readback 为 1 test 通过（27.55 秒）。

真实浏览器重新构建并打开 `evaluator-browser` acceptance bundle 后：

- Opportunity 唯一显示 `corrections: 1`、`delivery outcomes: 2 (passed 1 / failed 1 / unknown 0)`；
- correction/outcome 只显示 8 字节前缀短引用，私有 Session/message 和完整 64 字节 id 均未出现在可见文本；
- `No causal or authoring-eligibility claim` 明确可见且有非零布局；
- 点击控制面 `Refresh` 与整页 reload 后证据仍一致；页面 diagnostics 为 `[]`，console warn/error 为 0；
- ClawHub、Marketplace、Agent Skills、Local Git、Distribution 和旧 research 文案均未出现。

这仍是源码 acceptance bundle 的真实浏览器证据，不冒充最终 tarball 安装进 clean-profile 后的 DSH Web 浏览器门禁。

## 未完成

- feedback message 与具体 Skill invocation/result 的 exact causal link；
- 明确 rework、模型成本/时延、跨 Goal reuse、Retention、negative transfer 和 rollback 事件；
- 上述信号如何在不泄漏 evaluator/gold 的前提下形成 Candidate 输入和独立评测样本；
- 最终 tarball 的 clean-profile 浏览器复验、真实 provider outcome 和 Hermes 同条件 paired benchmark。

因此本证据不能支持发布 tag、自我进化完成或 Hermes 上位声明。
