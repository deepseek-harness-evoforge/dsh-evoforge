# P2C.1 证据：幂等 GitHub Draft PR

> 日期：2026-08-16  
> 声明等级：`implemented`；GitHub.com 同仓 branch 首片，不代表通用 Forge 发布系统

## 用户结果

当 `complete_delivery` 带 `draft_pr` 时，一个原生 Goal 只有在 exact commit/check 和 GitHub
Draft PR 都确认后才完成。Agent 不需要自己编排 push、查重、create、read-after-write 和
`update_goal`。

## Test-first 行为证据

红灯证明旧实现会忽略 `draft_pr` 并直接完成 Goal。绿色实现固定覆盖：

- 无效 base 或 `gh auth` 失败发生在 push 前，Goal 保持 active；
- push 使用 exact commit、`origin`、同名 branch，不使用 force；
- 无现有 PR 时创建 Draft，再读取 number/url/draft/head/base/commit 后完成 Goal；
- 模拟“远端已经创建但本地收到失败”：第一次返回 `unknown` 且 Goal active，第二次先查询并
  复用同一个 Draft，只有一个 create 调用；
- 已有 ready PR 返回 `failed`，不调用 create、不降级、不完成 Goal；
- publish 后重新核对本地 HEAD 与 clean worktree；
- title/body/branch 都经过既有 exact argv quoting，shell 元字符不会变成额外命令；
- P2B 的 native Tool guard、Goal revision、失败/取消、dispose 和固定 DSH Agent 回归继续通过。

## Cache 与权限

- 没有新增 Tool 或 Prompt；`draft_pr` 是原稳定 `complete_delivery` 的可选字段。
- 扩展后的完整 Tool Schema 仍通过 `≤ 2 KiB` serialized JSON gate；重复模型请求 Tool 数组相等。
- `gh auth`、`git push`、`gh pr list/create/view` 全部通过原生 shell Tool，因此 native
  sandbox/approval/guard 保持权威。
- pass 结果只加入 compact PR artifact 与每步 hash；不把 `gh auth` 文本或凭据写进模型结果。
- push/Draft PR 属于用户已授权的默认交付动作；merge、ready、release、deploy、secret read、
  付费和不可逆外部动作没有实现。

## 幂等与限制

远端 branch 和 PR 是事实源，无本地 publication journal。create 响应不确定时不会自动完成，
显式重试会先查 exact head/base。版本回滚不宣称删除远端 branch/PR。

当前只支持 GitHub.com、`origin`、同仓 branch；fork、GHES、GitLab、Gitea、reviewer/label、
更新 PR body、等待 CI 和 Evolve outcome adapter 尚未实现。无前端，因此不触发浏览器 E2E。

本机提供显式 `DSH_DELIVERY_LIVE_WORKTREE` gate，可在已经存在 Draft PR 的真实已登录仓库上
验证 exact push + remote reuse；CI 使用无密钥确定性边界，不创建外部 PR。

本轮已在公开仓库 live gate 运行：exact commit
`b42afd6dfc4756a8225b4ab295bf497008811be6` 复用
[Draft PR #7](https://github.com/deepseek-harness-evoforge/dsh-evoforge/pull/7)，结果 `1 passed`；
read-back 确认 `isDraft=true`、head `feat/p0a-case-pack`、base `main` 且 head OID 完全相等。
没有创建第二个 PR，也没有改变 title/body/review 状态。

设计取舍见 [ADR-0014](../adr/0014-remote-draft-pr-facts-are-idempotency-source.md)。
