# V5.227：Interaction-first Gap signal 与新 Tool surface epoch

> 日期：2026-09-05。范围：`dsh-evolve` 的 `report_capability_gap` 与 native Skill miss monitor；不是完整
> 自我进化闭环或 Hermes 上位替代证明。

## 变更

- 无 native DSH Goal 的普通 Interaction 现在会持久化 Capability Gap，并返回 `status: abstained`、
  `reason: missing-native-goal`。
- no-Goal signal 不触发旧的 Goal-linked opportunity/authoring 慢环；Web projection 显示可解释的 abstention。
- 模型可见工具说明改为 Interaction-first，并明确不搜索、下载或安装外部 Skill；这是新的
  composition/tool-surface epoch，不改写旧 epoch。
- schema v1、旧 Goal 路径和历史 benchmark 保持兼容；未来 Session/Candidate 规则仍需独立门禁。

## 验证

命令：`pnpm --filter dsh-evolve exec vitest run test/capability-gap-tool.test.ts test/capability-gap-monitor.test.ts`
以及对应的 store/generation e2e；结果为 4 files / 27 tests passed，`dsh-evolve` typecheck passed。

## 未完成与禁止外推

当前 opportunity discovery/evaluation 仍主要消费 Goal-linked evidence；本证据只证明“普通 Interaction 可记录并
fail-closed abstain”，不证明 no-Goal 已生成 Candidate、已自动晋升或已优于 Hermes。下一门是把独立、可重放
Interaction episode 接入慢环，并用新 benchmark epoch 重新测量 composition/cache/负迁移/回滚。
