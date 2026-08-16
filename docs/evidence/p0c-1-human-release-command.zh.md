# P0C.1 证据：Human Release Command

> 日期：2026-08-16  
> 声明等级：`implemented`；这是最小人工发布控制面，不是完整 review inbox

## 用户结果

安装 DSH Commands 的用户可以直接运行：

```text
/evolve status
/evolve promote <64-char-generation-id>
/evolve rollback
```

无需调用 `ctx.get('evoforge.evolution')` 或写脚本。命令只在 host plane 执行，不请求
模型；晋升仍先验证 exact Git commit/tree，只改变 future-session active pointer。

## 已验证边界

- `/evolve` 可以在 `dsh-evolve` 先加载、DSH Commands 后加载时动态注册；
- status 明确显示 native/active Generation、artifact 和精确 rollback target；
- promote 只接受完整 64 位 content id，不接受缩写、额外参数或未知动作；
- 重复 promote 是幂等结果；rollback 从 child 回 parent、从 root 回 native DSH；
- promote/rollback 前后当前 Agent 没有新增模型请求；
- 当前 Session 的 Tool surface 和既有消息前缀不变，未来 Session 才读取新 Skill；
- command lifecycle 是 DSH 原生 log-only `command/run` / `command/done`；
- hot unload `dsh-evolve` 后 command 自动注销；未组合 Commands 时基础插件照常工作。

## 可复核测试

```bash
pnpm --filter dsh-evolve exec vitest run test/evolve-command.test.ts
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-evolve exec vitest run test/generation-binder.e2e.test.ts
```

- `evolve-command.test.ts`：status、完整 id、幂等、parent/native rollback、错误输入；
- `generation-binder.e2e.test.ts`：真实 Commands/Agent/Session/Git Skill，零模型调用、
  future-session-only 和 hot unload。

## 仍未实现

- 尚无 Candidate 列表、claim/diff/case/cost 的 review inbox；
- 尚无 durable pause/resume；
- 尚无 Web/TUI 专用 projection；
- 尚无 P1 自动晋升或 canary。

因此这里只声明 P0C.1 人工 release command 已实现；P0C 总退出门仍未通过。
