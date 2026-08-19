# V4.22 运行时 Skill source/target 入口移除证据

> 声明等级：`implemented`，不是完整自进化、Hermes 上位或发布证据。

本增量纠正了先前审计遗漏：`dsh-evolve` 虽已删除 ClawHub、市场和 research Candidate，但仍公开 Git repository/source、静态 Skill/Case Pack target 与按 Skill 自动晋升配置。现在公开 Config 只保留 `cacheRoot`、`selfDiscoveryPolicies`、`candidateEvaluationPolicies` 和 `supervisor`；插件不再装配 Feedback Shadow target、Evaluator target、static Retention、per-Skill AutoPromotion 或对应 canary 链路。

验证覆盖：

- 公开 Config 契约精确拒绝 repository/source、目标 Skill、静态 Case Pack 和旧自动入口；
- 默认 Bundle root 从 `git-skills` 改为 `generation-cache`；
- 真实 macOS DSH Workspace/Session 隔离测试不再初始化 Git 仓库，改用内部 canonical `skill-bundle`；
- 真实 Agent Loop 的自然语言 Goal → model-declared Capability Gap 保持成立；
- 内部 Bundle 仍只影响未来 Session，重启后固定版本可恢复，root rollback 精确回到 native DSH；
- 旧文件中 19 条以 Git source/静态 target 为前提的集成规格及其 Git fixture 已删除而非跳过。

当前限制：私有 `GitSkillSource` 类暂时仍承担零 source 的内容寻址 Bundle materialization；旧 target 模块、Commands/Control 类型和 legacy Git persistence variant 尚未全部删除。它们不能由 profile 重新启用，也不构成本增量完成声明；后续必须以已安装 Skill 完整基线 Bundle 和内部证据链替换。

## 已执行验证

- 根级 `pnpm check` 退出 0：文档链接/公开路径、十一包 typecheck、全部测试和全部构建通过；`dsh-evolve` 为 65 files，290 passed、2 skipped；`dsh-evolve-web` 26/26，`dsh-gateway` 23/23。
- 更新后的 Cache Contract 全通过：真实自然 Goal → Capability Gap、GitHub Review composition、Goal cold resume、assembled delivery、飞书完整渠道 composition，以及十一包原生合同 22/22。
- 十一包最终 tarball clean-profile add/dump/boot、真实 Session/Goal/Storage/Tool、dispose/remove/reboot/readback 1/1 通过（32.76 秒）。
- Doctor 独立 packed add/Loader/command/remove 1/1 通过（4.36 秒）。
