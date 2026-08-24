# V5.13 Hermes EV-1 内容寻址重放证据

日期：2026-08-24

状态：`verified`（冻结 deterministic EV-1 及其余三个 Hermes epoch 已从当前 `main` 重放；真实模型、真实渠道和长期 paired 仍未完成）

## 审计发现

活动运行时在 V4.23 已删除 `GitSkillSource`，但
`benchmarks/hermes-v0.1/ev1-control-plane/run.ts` 仍直接导入该文件并发布 legacy `kind: skill` Git artifact。
因此 `pnpm benchmark:hermes:ev1` 实际以 `ERR_MODULE_NOT_FOUND` 退出；文档中的“冻结 epoch 可复跑”与源码事实不一致。

## 修正

- runner 直接把 frozen baseline/correction `SKILL.md` 组装成 canonical sealed `skill-bundle`；
- `GenerationBundleRepository` 在 pointer mutation 前重验 archive digest、tree hash、Workspace、Skill 和 lineage；
- baseline 与 Candidate 都使用当前 existing-Skill 内容寻址 Generation artifact，不恢复 Git source、ref、网络或能力获取；
- rollback 传入 exact expected active Candidate，保持并发漂移 fail closed；
- 根级 `pnpm check` 新增 `benchmark:hermes:ev1:typecheck`，使删除或改动活动模块后 benchmark 的编译漂移进入日常门禁。

## 实际验证

- 红态：`pnpm benchmark:hermes:ev1` 以缺失 `git-skill-source.ts` 失败；新增类型门同时报告该缺失导入和旧 rollback 调用签名；
- 绿态：`pnpm benchmark:hermes:ev1:typecheck` 退出码 0；
- `pnpm benchmark:hermes` 退出码 0，依次重放 EV-1、SD-1、LC-1、AS-1；
- 根级 `pnpm check` 退出码 0：全仓 `564 passed / 3 skipped`，RP-1 `8/8`、AS-2 `7/7` 未授权合同通过且没有付费 Provider 调用或真实飞书平台副作用；
- EV-1 仍为两端 `baseline fail → corrected pass`，EvoForge active-before-explicit-promotion 为 0、Hermes 为 1；
- EvoForge 的 baseline immutable、old Session pin、future Session Candidate、cross-Workspace fail-closed、rollback/restart exact 六项 hard gate 全为 true；
- 四个 frozen `result.json` 均未修改，防止用架构迁移偷偷重写旧 benchmark 结论。

## 声明边界

本增量恢复的是旧 deterministic epoch 的真实性和可重放性，不新增模型调用、外部网络、渠道效果或长期 Outcome。
它不能证明当前 Hermes revision 下的同模型质量、真实 Provider 自进化、真实飞书交付、误晋升率、负迁移、遗忘或整体上位替代；这些仍阻止 tag 和完成声明。
