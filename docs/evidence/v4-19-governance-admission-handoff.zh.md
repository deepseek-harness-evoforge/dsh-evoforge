# V4.19 — 治理包可进入确定性 Admission 与 assembled Holdout

日期：2026-08-19
状态：`implemented`，真实 provider assembled Goal 验收仍 pending

## 发现的生产断点

V4.18 已能从密封 Goal 证据形成 admission/holdout Case Pack，但生成器把两份 manifest 都写成 `dshAssembled: true`。`SkillCandidateAdmission` 为保证 Candidate 代码不在准入阶段执行，会正确拒绝任何 assembled evaluator。因此原自动链条在具备真实 provider 时仍会固定停在 `assembled-evaluator-not-governance-separated`，无法把 Candidate 交给独立 holdout。

## 修正

- 治理面按角色形成执行协议：admission 为 deterministic filesystem、`dshAssembled: false`；holdout 为真实 DSH、`dshAssembled: true`。
- admission 没有被放宽：Candidate 仍不执行、不调用模型/网络；只有通过准入的 exact Candidate 才进入后续 assembled holdout。
- provider 作者提示按角色约束：admission 生成文件评测器，holdout 生成真实 DSH capability-absent 评测器。
- `SkillEvaluationGovernance.scan` 新增有界脱敏只读 seam；Host Remote 与 DSH Web 展示 phase、pending role、0–2 次治理调用、input/output token、预算 retry 和失败分类，不暴露 protected Goal、provider identity、路径或 evaluator。
- budget deny 现在持久化为 `budget-deferred`；重启/刷新仍可解释最早 retry。治理作者调用异常返回后立即持久化 `uncertain`，重启保持该状态且不盲重试。

## 自动化与浏览器证据

- 红测首先得到 `incomplete / assembled-evaluator-not-governance-separated`；生产修正后，同一 governance-authored Envelope 返回 `qualified-for-shadow`，manifest 同时证明 admission=false、holdout=true。
- 治理单测覆盖 ready 成本 `2 calls / 40 input / 20 output`、uncertain 脱敏归因和 durable budget-deferred retry。
- Control Plane 测试证明只读 Remote 携带治理摘要且不包含私有路径/内容；Typert 由固定 DSH revision 重新生成。
- `dsh-evolve-web` 客户端测试展示独立治理卡片、seal、2 次调用成本和无发布权限。
- 源码 browser acceptance bundle 在真实浏览器中显示唯一 `Independent evaluation governance` 卡片；标题与 ready 状态均有非零布局，reload 后仍唯一可见，刷新前后 console warn/error 均为 0。
- 最终代码的 `dsh-evolve` 定向治理链为 13/13，通过完整包测试 297/299（另 2 skipped）；`dsh-evolve-web` 为 26/26，类型与构建均通过。
- 根级 `pnpm check` 退出码为 0，覆盖文档、十一包 typecheck、全测试与全构建；完整 Cache Contract 及 Doctor 十一包原生合同 22/22 通过。
- 十一份最终 tarball 在新 clean profile 完成 add/dump/boot、真实 Session+Goal+Tool、dispose/remove、再次 boot/readback，1/1 通过（37.38 秒）。这只证明 DSH 插件生命周期，不能替代下一节所列真实 provider outcome。

## 明确不证明

- 本机没有配置 proposer/governance 两套独立 provider 环境变量；上述 provider author 是测试边界注入，不是实际模型语义成功率。
- 浏览器使用 acceptance fixture 验证真实 DOM/刷新，不冒充真实 DSH provider 结果。
- 尚未完成真实未见 Goal 的 author→admission→assembled holdout→Retention→Outcome、同条件 Hermes paired epoch 或长期误晋升/负迁移数据。
- 因此不创建 tag，也不声明自我进化或 Hermes 上位替代已经完成。
