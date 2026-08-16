# P1.4 证据：私有 Feedback Case Draft

> 日期：2026-08-16  
> 声明等级：`implemented`；完成最小授权草稿，不代表可重放 Case、Candidate 生成或持续进化闭环

## 用户结果

管理者配置私有 `feedbackDraftRoot` 后，用户可以在 host-only 控制面列出当前显式反馈引用，并把
一条仍有效、可精确归因到单个 Generation Skill 的纠正显式保存成 Case Draft：

```text
/evolve feedback
/evolve feedback <64-char-signal-id>
/evolve feedback <64-char-signal-id> draft <skill-name>
```

草稿可供人检查或交给后续 evaluator 编译器，不会自动改 Skill、创建 Candidate 或触发发布。

## Test-first 行为证据

真实 DSH command-level 验收先以红灯固定缺口：`/evolve feedback` 不存在，因此无法得到 Signal id
或创建草稿。最小实现转绿后证明：

- 固定 revision DSH 的真实 Agent/Skill/ToolSkill/Session Persistence/Message Feedback/Commands
  组合生成一个直接用户输入、一次显式 Generation Skill invocation 和 assistant message；
- 官方 `MessageFeedbackService.put` 写入带备注负反馈，随后 host command 创建一个内容寻址 JSON；
- JSON 绑定同一 feedback version、Session、message、turn、assistant seq、Generation、exact Git
  commit/tree 和 whole-Skill content hash，只复制直接用户文本与 correction；
- JSON 不含 fixture Skill body、Tool output 或 assistant response；文件权限不向 group/world 开放；
- 相同命令重试返回 `already exists` 且目录不新增文件；
- feedback 改成正向并撤回 P1.3 Signal 后，旧 signal id 立即报
  `feedback signal is no longer current`；
- 多 Skill invocation、反馈版本漂移和权限过宽目录均 fail closed；
- 创建、重试和撤回全程没有新增模型请求。

本地完整 `pnpm check` 通过：`dsh-evolve` 105 passed / 2 个显式 skip，
`dsh-software-delivery` 24 passed / 1 个显式 skip，合计 129 passed / 3 skipped；docs、typecheck、
两个包的 build 同时通过。关键命令：

```text
pnpm --filter dsh-evolve exec vitest run test/feedback-case-draft.test.ts
pnpm --filter dsh-evolve exec vitest run test/generation-binder.e2e.test.ts -t "creates one private idempotent Case Draft"
pnpm check
```

功能提交 `dd693016a8e650a584f1c4b4fc024e7daf5c3a30` 已推送到公开 Draft PR #7；精确提交的
[CI run 31949137167](https://github.com/deepseek-harness-evoforge/dsh-evoforge/actions/runs/31949137167)
全部通过：Node 22.19.0 为 34 秒，Node 24 为 32 秒，macOS 固定 DSH assembled lane 为
2 分 04 秒，其中 Evolve selected tests 为 41/41。macOS lane 显式包含私有 draft 拒绝门和真实
DSH command-level 验收，并继续复跑 sealed Shadow/canary、Jobs、Generation、crash recovery、
安装/卸载与 Software Delivery 边界。
`dsh-evolve` tarball 只含声明的 `dist` 文件、README、LICENSE 和 package manifest。

## Cache、授权与未完成边界

- 正常 Session、反馈 intake 和草稿命令都不增加 Tool、system prompt、Skill catalog 项或模型调用；
  草稿命令位于 host plane，额外模型 token 为 0。
- `feedbackDraftRoot` 是允许复制最小原文的配置授权，具体 command 是逐条授权。没有二者就不复制
  note/user text。根目录要求 `0700` 等价权限，文件要求 `0600` 等价权限。
- 草稿不是原生反馈或 Session 的第二权威；创建前后都重新核对原生 feedback version。
- 草稿没有 reproduction fixture、expected checks、replay result 或 evaluator score，因此不能自己
  充当 Trial 真相。P1.5 已允许它在 exact Skill 匹配时只引导 proposer，并继续使用既有可信 Case
  Pack 独立评测；全新失败类型仍需要一个具体 evaluator，不建设通用 Case SDK。

设计取舍见 [ADR-0018](../adr/0018-feedback-case-drafts-require-explicit-private-copy.md)。
