# V4.48 现有 Skill Canary 回滚的最终 tarball 浏览器生命周期

日期：2026-08-21
状态：`verified`（最终 tarball 的人工批准、future-Session 晋升、failed-Outcome Canary、断连保留、精确回滚、冷恢复与官方卸载已验证；两套独立真实 provider、长期率、真实飞书 exact route 与 Hermes 同条件 paired benchmark 尚未完成）

## 本增量回答的问题

V4.46–V4.47 已实现 existing-Skill failed-Outcome Canary、权威 Control/Remote/Web 与独立 expected-active rollback gate，但证据仍停留在注入式 Host/组件自动化。V4.48 从最终发布 tarball 和全新 DSH profile 出发，验证用户在真实 DSH Web 中完成的批准、晋升和回滚确实经过生产 Host owner，并在断连、整页刷新、进程重启和卸载后保持精确状态。

## 固定对象与测试边界

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`。
- 验收起点：`main@fcddb926378a320b410edf6eb70d4760f99a5777`。
- `dsh-evolve-0.1.0-alpha.1.tgz`：`sha256:33f4a314e26ac1fba0e106932f822e0c6e924cf326e4618da1f0e4409844746f`。
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：`sha256:c09fb5c85feebee2f01cf180d83a7e598e177346944446759bc6d41f3ba41226`。
- 浏览器 fixture 是 test-only overlay，不进入两个 tarball。它准备 exact Candidate、Admission、Holdout、Retention 和 terminal Canary durable evidence，但禁止调用 approve、promote 或 rollback；三个 mutation 均由最终 Web → 固定 Typert Remote → Control → 独立 Host gate 完成。
- Canary fixture 只证明最终包对精确 durable evidence 的重验、动作分权和恢复语义，不冒充真实 provider 效果。

## 真实浏览器结果

1. 用 DSH 官方 `plugin --profile web add` 将两个最终 tarball 安装到全新隔离 profile；`--dump-config` 显示安装包 Typert Loader、Host Bundle、Client Module 和 test-only overlay，真实 Host 在 `127.0.0.1:43847` 启动。
2. Skills 视图首先显示 `verify-dsh-release` 的 exact Admission/Holdout/Retention 证据和“需要人工决策”。填写备注并二次确认后，只发布 inactive Generation `936793c9…`；页面明确“当前和未来 Session 均未改变”。
3. 再次独立确认后才把该 Generation 晋升给未来 Session；概览由 0 变为 1 个进化 Skill 正在使用，Skills 视图明确“将用于这个 Workspace 的新 Session”，当前 Session 固定。
4. 同一 profile/端口重启后，test-only fixture 只在权威 release 仍为 approved 且 active pointer 精确匹配时写入 terminal Canary。真实 Host 投影显示 Candidate `7e986913…`、baseline pass、Candidate fail、4 Trial、pointer/input/tree/composition/calibration 全稳定、proposer 0 和 evaluator 无 mutation 权；只有该活动 Generation 的行显示“使用既有 Skill Canary 回滚”。
5. 在二次确认后、Remote mutation 前停止 Host。页面明确显示 `evoforgeEvolution/rollbackExistingSkill failed: Failed to fetch`，同时保留上一份 Canary、活动 Generation、模型/token/cache 和完整性证据；断连没有被伪装成成功，也没有清空最后成功快照。
6. 同一 profile/端口恢复后重新发起 exact Canary 回滚。独立 Host gate 重验 Canary 与权威 release 后调用 Store expected-active compare；release 回到“已发布为未激活 Generation”，未来 Session 不再使用 Candidate，当前 Session 不漂移。Canary 历史 verdict 保留作审计证据，但回滚按钮消失，因为 active Generation 已不再匹配。
7. 整页 reload 后，inactive release、Canary 历史证据和“无回滚按钮”保持；再次停止并重启 Host 后仍相同。浏览器 console error 数为 0。
8. DSH 官方 `plugin --profile web remove dsh-evolve-web dsh-evolve` 后，profile 只剩官方 base/web bundles，两个 `node_modules` 入口均不存在，默认 dump 的 `dsh-evolve|evoforge` 计数为 0；不带 overlay 的原生 DSH Web 在 `127.0.0.1:43848` 再次启动并返回 `DeepSeek Harness`。

## 自动化与包边界

- `package-contract.test.ts` 固定 test-only overlay 必须显式启用 existing-Skill Canary fixture、包含 terminal result schema，并禁止 fixture 调用 `approveExistingSkill`、`promoteExistingSkill` 或 `rollbackExistingSkill`。
- fixture 只在首次真实 Web mutation 已把 release 变成 approved + active 后才准备 exact Canary；回滚后的冷重启不会重新激活或重新生成可执行回滚动作。
- 最终全仓 `pnpm check` 以退出码 0 通过文档、11 包 typecheck、515 passed / 3 skipped 与全部 build；本页所述浏览器和卸载步骤均直接针对上述两个最终 tarball。

## 尚未证明

- deterministic durable fixture 不是两套独立真实 provider 的 paired Trial，也不能给出长期误晋升、负迁移、遗忘或误回滚率。
- exact 飞书用户消息/回复/Approval、真实 provider assembled 整链、同任务/模型/权限/预算 Hermes paired epoch 仍阻止 tag 和“上位替代完成”声明。
- 缺失 Skill 路径的 Canary/rollback 最终 tarball 浏览器恢复仍需单独验收，不能由本 existing-Skill 证据替代。
