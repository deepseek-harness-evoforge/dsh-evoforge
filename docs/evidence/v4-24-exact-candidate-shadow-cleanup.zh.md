# V4.24 exact Candidate Shadow 与历史 target 架构清理证据

> 声明等级：`implemented`。本页证明活动源码、打包运行时、Host Remote、DSH Web 和渠道 attention 已删除旧静态 target/草稿架构；不代表 Retention/canary、existing-Skill 再进化、真实 provider 或 Hermes 上位验收已经完成。

## 本次修正

- `ShadowOptions.exactCandidate` 改为必填；Shadow 只执行 exact、内容寻址、lineage 完整且 `trial.dshAssembled=true` 的内部 Candidate。
- Shadow 删除运行时 proposer 请求、反馈草稿、静态 target 搜索、Git source/ref 和模型环境变量入口；Shadow 自身模型调用固定为零。
- durable Shadow state/supervisor 删除 `proposal-pending`、feedback draft、launch signal 和 proposer effect；恢复必须重验 exact Candidate 目录与身份。
- 物理删除未装配的 Git Skill source、Feedback Case Draft/launcher、Evaluator Draft inbox/authoring、automatic feedback/evaluator/inflight、static Retention、counterfactual canary、sealed canary runner、automatic review expiry/retention/promotion 编排及其旧测试和浏览器夹具。
- Host control/Remote 只保留 overview、review、pause、resume、approve-review、reject-review、promote、rollback；Typert 产物按固定 DSH revision 重新生成。
- DSH Web 删除 target 选择、付费 feedback Shadow、Evaluator Draft、自动预算/过期交互。纠正只显示已进入内部归因、聚类和评测治理闭环，不提供“处理纠正”路径菜单。
- `dsh-evolve-attention` 只提醒 Candidate review 或 inactive promotion decision，不再投影 Evaluator Draft。

## 负向边界

源码级回归禁止 Shadow 重新出现 `requestProposal`、`fetch(` 或 `DSH_EVOLVE_MODEL_`；packed runtime 回归禁止 `GitSkillSource`、隐藏 generation ref、`shadowTargets`、`evaluatorTargets`、`feedbackDraftRoot` 和 Feedback Case Draft。旧持久化形状只能在明确的历史兼容/拒绝边界读取，不能恢复旧活动路径。

## 验证

- `dsh-evolve`：48 个测试文件通过、1 个条件跳过；177 项通过、1 项条件跳过。
- `dsh-evolve-web`：2 个测试文件、18 项全部通过。
- `dsh-evolve-attention`：4 个测试文件、11 项全部通过。
- 根级 `pnpm check` 覆盖文档检查、十一包 typecheck、测试与构建；Gateway、Doctor、Software Delivery、Telegram、飞书和其他插件保持通过。
- `pnpm test:cache-contract` 全通过，包括自然 Goal→Gap 64-turn 稳定性、Review、Goal Continuity、assembled Delivery、飞书完整渠道组合与 Doctor 原生插件合同 22/22。
- 十一包最终 tarball 在全新 DSH profile 完成 add、dump、boot、真实 Session/Goal/Storage/Tool、dispose、remove、reboot/readback，1/1 通过（60.96 秒）；Doctor 独立 packed add/Loader/Command/remove，1/1 通过（10.35 秒）。

本增量不创建 tag。下一阶段是按内部 Opportunity/Candidate 证据重建 Retention/canary/outcome 闭环，补 existing-Skill 完整 Bundle baseline/Candidate、真实 provider assembled 评测、真实飞书 exact route 和同条件 Hermes paired benchmark。
