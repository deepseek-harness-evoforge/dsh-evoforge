# V4.42 现有 Skill Retention 权威 Web 与真实浏览器

日期：2026-08-21
状态：`verified`（最终 tarball 的 DSH Web 投影、刷新、Host 断连保留、恢复和官方卸载已验证；真实 provider、Canary/晋升/回滚仍未完成）

## 本增量回答的问题

V4.41 已产生 exact existing-Skill Retention 结果，但用户无法在 DSH Web 中读取它。V4.42 把 Host 的有界权威投影接入现有 `dsh-evolve-web` Skills 视图，并验证浏览器在 Host 暂时不可用时不会把证据清空或伪装成成功。

## 实现事实

- `dsh-evolve-web` 只读取 `EvolutionControl.overview().existingSkillRetentionEvaluation`；不读取 Host 路径、保护 Goal/Case、evaluator/provider identity，不调用模型，也不获得晋升、回滚或发布 mutation seam。
- Skills 视图显示 Workspace policy/warning、Skill、status/verdict/reason、Candidate/Holdout/Admission/Envelope、baseline/Candidate/Holdout/Retention tree、四象限、calibration/assembled/composition/input-integrity、model calls、input/output/cache-read 和“无晋升或发布权限”。
- `hasVerificationTarget()` 把 Retention 纳入可观察目标；不可读、错配或 warning 只会 fail visible，不能渲染为 retained。
- 浏览器刷新失败沿用现有 Remote 合同：展示 exact `evoforgeEvolution/overview failed` 错误，同时保留最后成功快照；同 profile/端口恢复后再次刷新才清除错误并采用新的 Host 权威状态。
- 测试 fixture 使用与生产 policy 相同的 lexical `resolve(runRoot)`。macOS `/tmp` 实路径为 `/private/tmp`；若 fixture 单独 `realpath()`，其 durable `reportPath` 会与 scanner root 不一致并被正确拒绝。V4.42 的真实浏览器红测发现并修复了这个测试契约错误。

## 自动化证据

- `evolution-action.client.test.tsx` 验证完整 Retention 卡片、精确 identity/hash、四个 integrity gate、模型/token/cache facts 和无发布权声明。
- `package-contract.test.ts` 固定 test-only bootstrap、最终 tarball 不含 fixture，以及 Holdout/Retention durable fixture 必须按生产 root 解析。
- `pnpm --filter dsh-evolve-web typecheck && pnpm --filter dsh-evolve-web test`：2 files / 20 tests passed。

## 最终 tarball 与真实浏览器

- 从当前源码生成 `dsh-evolve-0.1.0-alpha.1.tgz` 与 `dsh-evolve-web-0.1.0-alpha.1.tgz`，通过 DSH 官方 `plugin --profile web add` 安装进隔离 profile；组合 dump 确认 Typert loader、Host、Web 和 test-only overlay 生效。
- 真实 DSH Web 首次加载和整页 reload 后，Retention 标题唯一；`verify-dsh-release` 显示 `retained`，四象限为 `fail/pass`，四个 gate 全为真，模型调用为 `1/1`，usage 为 `100/20/60` 与 `90/18/70`，不可读 Holdout/Retention 计数均为 0。
- 停止 Host 后点击“刷新”，页面显示 `client api: evoforgeEvolution/overview failed: Failed to fetch`，但完整 Retention 快照仍在。重启同一 profile/端口并再次刷新后 alert 数为 0，证据保持唯一且一致；浏览器 error log 为 0。
- 通过 DSH 官方 `plugin --profile web remove dsh-evolve-web dsh-evolve` 卸载；profile dependencies 为空、两个 node_modules 入口均不存在，默认 composed config 不再包含 `dsh-evolve` 或 `evoforge`。

## 发布边界

- 本增量验证的是确定性 durable fixture 经真实最终 tarball、真实 Host Remote 和真实浏览器的读路径，不是两套独立真实 provider 的效果证明。
- existing-Skill Canary、future-Session 晋升、精确回滚、真实飞书 exact route、Hermes paired benchmark 和长期负迁移/误晋升/误回滚数据仍阻止 tag 与完成声明。
