# P0C.2 证据：Review 到未激活 Generation

> 日期：2026-08-16  
> 声明等级：`implemented`；完成异步人工复核和不可变候选发布，不等于自动晋升

## 用户结果

配置 Shadow run root 后，用户可以在 DSH 原生命令面查看已完成、可行动的候选：

```text
/evolve review
/evolve review <64-char-review-id>
/evolve review <64-char-review-id> reject <note>
/evolve review <64-char-review-id> approve <note>
```

列表和详情显示建议、Skill、claim、变更文件、baseline/Candidate tree、逐 case 结果、
proposal token、Trial 次数、composition、理由和限制。拒绝只记录证据绑定的 durable
处置；批准先产生不可变 Git ref 与 inactive Generation，再记录处置。两者都不调用模型，
也不阻塞产生该候选的原 Session。

批准并不激活。命令返回完整 Generation id，用户仍需单独执行：

```text
/evolve promote <64-char-generation-id>
```

## 已验证边界

- inbox 只扫描显式 run root 的直接子目录，不跟随目录符号链接；
- `run-state.json`、`report.json`、`review-state.json` 必须是 owned regular file；
- 只接收 `complete + promote/review`，拒绝损坏、不完整、`reject` 或证据漂移的 run；
- review id、proposal hash 与 evidence hash 均为完整 SHA-256，动作不接受缩写；
- 一个损坏 run 只产生有界 warning，不阻断其他候选；
- 人工拒绝持久化，重启后不会再次出现在 pending inbox；
- 批准前重建 exact baseline/Candidate tree；过期 baseline 在写 ref/Storage 前失败；
- Git commit/ref 可确定性重试，用户 `HEAD`、branch 和 worktree 均不变化；
- inactive Generation 保留 active parent 与不相关 artifact，且发布不移动 active pointer；
- exact Git Skill Provider 验证完成后才写入 Generation Storage；
- 真实 DSH Commands/Agent 测试证明：review/approve 零模型调用，live Agent 继续 native；
  显式 promote 后只有 future Agent 得到 Candidate。

## 可复核测试

```bash
pnpm --filter dsh-evolve exec vitest run \
  test/review-inbox.test.ts \
  test/candidate-publisher.test.ts \
  test/evolve-command.test.ts

DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness \
  pnpm --filter dsh-evolve exec vitest run test/generation-binder.e2e.test.ts
```

本次纵切覆盖 17 个 inbox/发布/命令测试和 8 个固定 revision DSH 端到端测试。

## 当前限制

- 详情显示变更文件和 sealed tree，不提供逐行 diff viewer；
- 只发布单个受管 Skill 的文本 proposal，不发布代码、工具、权限或外部效果；
- 尚无 durable pause/resume；
- 尚无 Web/TUI projection；当前 host-only Commands 不需要浏览器 E2E；
- 尚无 P1 自动晋升、canary、真实 provider 长期误晋升数据或生产发布支持。

因此 P0C.2 只声明“异步 review 可形成未激活、可审计、可重试的 Generation”。
它没有把批准偷换成激活，也没有宣称完整持续进化已经完成。关键取舍见
[ADR-0010](../adr/0010-approved-candidates-use-owned-git-refs.md)。
