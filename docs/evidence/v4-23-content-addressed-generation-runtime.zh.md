# V4.23 内容寻址 Generation 运行时替换证据

> 声明等级：`implemented`。本页只证明活动 Generation 路径不再依赖 Git source/ref 或静态 target；不代表 existing-Skill 再进化、真实 provider、Hermes 上位或发布完成。

本增量把 V4.22 仍暂存于活动运行时的零-source `GitSkillSource` 完整替换为 `GenerationBundleRepository`：

- 只接收明确的 `skill-bundle` Generation artifact；没有 source catalog、repository fallback、按名字查找、网络请求或 Git 对象/ref 写入；
- 对 canonical archive、artifact digest、tree hash、Candidate Lineage、Workspace、Skill name、路径、文件字节和 owned cache manifest 逐层重验；
- 只从只读内容寻址目录构造 DSH `SkillProvider`，缓存被加文件、改字节、换 manifest、symlink 或特殊文件时 fail closed；
- persisted legacy Git artifact 只保留为历史 Storage shape，在 Provider 边界明确 quarantine，不能进入新 Session；
- `CandidatePublisher` 只允许经过 review 的完整 capability-absent whole-Skill Bundle。existing-Skill 在完整 DSH-native baseline Bundle 尚未封存前明确 abstain，不回退到 Git repository 或 invocation hash；
- `/evolve` 已删除 feedback draft、静态 Shadow target、evaluator target 和按 Skill自动策略的命令入口；只保留证据查看、Candidate review、pause/resume、future-Session promote 和 rollback；
- packed runtime 负向契约直接扫描最终 `dist/index.mjs`，禁止 `GitSkillSource`、无-source Git fallback、隐藏 generation ref 和旧静态 target 配置重新进入可安装产物。

## 自动化证据

- `candidate-publisher.test.ts`：whole-Skill preview/publish/provider、lineage/content tamper、capability-absent 冲突、legacy quarantine、existing-Skill abstain；
- `evolve-command.test.ts`：删除的 target/evaluator action 返回固定 usage，review 只处理 exact Candidate Bundle，晋升只影响 future Session；
- `package-runtime-surface.test.ts`：最终打包运行时的负向实现契约；
- `generation-store.e2e.test.ts` 与 `native-workspace-evolution.e2e.test.ts`：真实 DSH Loader、Workspace、Session pin、重启和隔离仍通过。

本次同一工作树验证结果：

- 根级 `pnpm check` 退出 0：文档检查、十一包 typecheck、tests 和 builds 全部通过；`dsh-evolve` 65 files、279 passed、2 skipped，`dsh-evolve-web` 26/26，`dsh-gateway` 23/23；
- Cache Contract 全通过：自然 Goal → Capability Gap、GitHub composition、Goal cold resume、assembled delivery、飞书完整渠道 composition 和十一包原生合同 22/22；
- 十一包最终 tarball clean-profile add/dump/boot、真实 Session/Goal/Storage/Tool、dispose/remove/reboot/readback 1/1（31.32 秒）；
- Doctor packed add/Loader/command/remove 1/1（4.07 秒）。

## 尚未完成

源码树仍有未被插件装配的历史 Feedback/target/Git 模块和对应历史规格，`Shadow` 内也仍有应拆除的旧 proposer 分支；它们不能从当前 Config、Command 或 active provider 路径启用，但下一增量仍要物理删除并收紧 Control/Web 类型。existing-Skill 的完整 native Bundle baseline、内部 Retention/canary 重接、真实 provider 与长期 outcome 仍是发布阻断项。
