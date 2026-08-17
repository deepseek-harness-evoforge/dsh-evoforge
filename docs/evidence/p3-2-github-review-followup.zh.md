# P3.2：GitHub Draft PR 审查返修证据

> 状态：`implemented`。自动化、真实 DSH 装配、打包生命周期、GitHub CLI 授权与公开 GitHub API
> 只读冒烟已通过；尚无真实 `CHANGES_REQUESTED` 人工闭环和多日 soak，因此不是 production-ready。

## 用户结果

`dsh-software-delivery` 完成 exact commit 并创建或更新 Draft PR 后，allowlist 内的人类 reviewer 可在该
exact head 提交 `CHANGES_REQUESTED`。`dsh-github-review` 将一份有界、不可信的 review 追加到原生
DSH Session，Agent 继续同一个 Goal 修改、测试、提交并更新同一个 Draft PR。merge、release、生产部署、
秘密、付费和不可逆动作的权限没有扩大。

## 自动化证据

| 证据 | 当前结果 |
|---|---|
| 包测试 | 10 个测试文件、27 个测试通过；覆盖配置、delivery 观察、GitHub 读取（含合法 `PENDING` 数据）、筛选/截断、Storage、runtime、生命周期、cache composition、真实 DSH 纵切和 tarball add/remove |
| 真实 DSH 纵切 | headless DSH 接收 canonical `complete_delivery` 结果，读取可控 GitHub HTTP 快照，再通过真实 `Agent.followup` 把不可信消息追加到原 Session；记录最终为 `delivered` |
| 崩溃窗口 | `Agent.followup` 暂时失败时保持 `prepared` 并在下次 scan 恢复；消息已进入 Inbox、settle 前崩溃的模拟恢复只确认状态，不二次调用 follow-up |
| 长期有界 | 每个 Agent + repository 只有一个当前 watch；新 delivery 使旧 head 的 prepared 记录 `superseded`；终态历史最多 1000 条且不删除待恢复记录 |
| 不可信输入 | 仅 exact head、`CHANGES_REQUESTED`、allowlist human 可触发；正文/字段/评论数有硬上限，控制字符清理；URL 由已校验标识重建，不采用 API 返回 host |
| GitHub 故障 | ETag `304` 无新记录；HTTP/Schema/分页超限返回 `unknown`，不注入 Session；请求有 20 秒默认超时且禁止 redirect |
| KV Cache | 启用插件前后，真实 DSH 普通模型请求完整序列化等价；插件为 0 Tool/Skill/Prompt/System Message。只有 actionable review 在尾部新增一个有界 user message |
| Package 边界 | packed tarball 可 add、disabled dump、真实 boot/open Storage Domain、remove；卸载后配置无残留插件行 |

执行命令：

```bash
pnpm --filter dsh-github-review test
pnpm --filter dsh-github-review typecheck
pnpm --filter dsh-github-review build
```

## 真实 GitHub 验证

2026-08-17 在公开仓库执行：

- `gh auth status`：active account 为 `zhaoquan219`，Git protocol 为 SSH；
- `gh api user`：返回同一 `User` 账号，证明设备授权已经完成，不只是浏览器成功页；
- `gh pr view 26 --repo deepseek-harness-evoforge/dsh-evoforge`：PR `#26` 为 open Draft，head
  `def5dc73076f805181cfae475991d1db8da0a749`；
- 用构建后的 `GitHubReviewClient`、不传 token 读取官方公开 REST endpoint：返回 `modified`、有效
  ETag、0 reviews、0 comments。

这证明了当前机器 GitHub 授权和插件的公开只读网络路径。PR #26 当时没有 review，因此不能把这次冒烟
写成“真实 changes-requested → Agent 返修闭环”；该链路目前由真实 DSH + 可控 GitHub HTTP 自动化覆盖。

## 已知限制

1. 首版只支持 GitHub.com 同仓 Draft PR，不支持 Enterprise、fork、webhook、GitHub App 或组织级发现。
2. 每次最多接受 100 reviews、每个 actionable review 最多读取 100 inline comments；超限 fail closed。
3. 默认公开仓库无需 secret；私有仓库只有显式 `tokenEnv` 策略才读取一个 Pull requests read token。
4. 插件不读取 CI 日志、不判断修改是否正确、不自动 merge，也不把 reviewer 变成 Approval authority。
5. 尚缺真实 reviewer、真实 Agent 返修、长时间网络故障、rate-limit 和多日 resident 数据。

## 声明口径

可以声明：P3.2 已实现 cache-safe、崩溃可恢复、可删除的 Draft PR 审查返修入口，并验证了真实 GitHub
只读接入。

不能声明：返修质量已经优于人工流程、GitHub 生产可靠、所有 code review 已自治，或 EvoForge 已全面
上位 Hermes。
