# P1.1 证据：Opt-in Clear-Instruction Auto Promotion

> 日期：2026-08-16  
> 声明等级：`implemented`；默认关闭、实验性，不等于 P1 canary/自动回滚完成

## 用户结果

用户可以只对明确列出的受管 Skill 开启最窄自动晋升：

```yaml
autoPromote:
  skills:
    - stable-evolved-skill
```

配置存在时，resident scan 会检查已完成 Shadow evidence。只有固定策略全部通过时，
Candidate 才会先发布成 inactive Generation，再自动切换 future-session active pointer。
任何模糊、超范围或受保护效果候选继续留在 `/evolve review`，不阻塞普通 Session。

`/evolve status` 显示 allowlist；`/evolve review <id>` 显示该候选是 eligible，还是因哪些
固定门进入人工复核。判断不调用模型。

## `auto-clear-instruction-v1` 固定门

1. Skill 必须在显式 allowlist，exact Git baseline 未漂移；
2. Shadow recommendation=`promote`；至少一个 sealed `fail → pass`；Candidate 所有 case/check 通过；Trial≥4；
3. assembled evaluator 明确给出 non-target composition stable；
4. 只允许一个 `SKILL.md`，且只能在原正文末尾非空追加；
5. 增量最多 2 KiB；出现 protected action、工具、权限、秘密、网络、部署、付费、消息或日程词即转人工；
6. limitations 必须全部属于版本化 allowlist。

这是一组足够窄、可解释的 deterministic gate，不使用模型自评。词法门是保守分流器，
不是语义安全证明；实际 Protected Action 仍由 DSH Approval/Permission 强制。

## 已验证边界

- 默认没有 `autoPromote.skills` 时，所有行为保持 P0C 人工模式；
- policy 对 append-only clear win 放行，对 rewrite、protected term、composition 不稳定和 ambiguous recommendation 拒绝；
- durable review actor 与 Generation `policyVersion` 都是 `auto-clear-instruction-v1`；
- publish 成功、promote 前崩溃时，下次 scan 从 automatic actor + Generation id 完成晋升，不重复发布；成功移动 pointer 后再写 `activatedAt`；
- automatic approval 若尚无 `activatedAt` 会继续显示在 review inbox；分支/parent 冲突不会只剩后台日志；
- rejected 或 human-approved Candidate 永不被自动策略激活；
- 多候选仍受 active-parent/exact-baseline gate 约束，不会跨分支强推；
- late-composed native Jobs 能启动 resident policy；`/evolve pause` 同时停止自动扫描；
- 真实 DSH Agent 测试中 live native Session 不漂移，future Session 才获得新 Skill；
- 自动处理没有新增模型请求，用户 Git HEAD/worktree 不变。
- resident policy、status 和 review explanation 的模型 token 为 `0`；唯一可能新增的模型输入是 future Session 按原生 Skill 路径实际加载已晋升正文时的 ≤2 KiB append，具体 token 数由 tokenizer 决定；既有会话前缀不变。

## 可复核测试

```bash
pnpm --filter dsh-evolve exec vitest run \
  test/auto-promotion-policy.test.ts \
  test/auto-promoter.test.ts \
  test/review-inbox.test.ts \
  test/candidate-publisher.test.ts \
  test/shadow-supervisor.test.ts \
  test/evolve-command.test.ts

DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-evolve exec vitest run test/generation-binder.e2e.test.ts
```

## 当前限制

- 没有 future-session canary 分流、真实 outcome monitor 或自动 rollback；
- 仅允许 `SKILL.md` 小幅 append，其他合理改动也会进入人工 review；
- 当前 assembled evidence 与真实 DSH E2E 在 macOS 固定 revision 验证；
- 尚无真实 provider 长期 false-promotion、false-rollback、review-rate 和返工下降数据；
- 不允许代码、脚本、工具、权限或外部效果自动激活；
- pre-alpha 不建议在生产 profile 开启。

因此这里只声明“最窄、默认关闭、崩溃可恢复的纯指令自动晋升路径已实现”。
完整取舍见 [ADR-0011](../adr/0011-automatic-promotion-is-an-opt-in-clear-instruction-policy.md)。
