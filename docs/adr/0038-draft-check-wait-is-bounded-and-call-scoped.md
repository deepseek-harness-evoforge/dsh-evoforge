# ADR-0038：Draft checks 等待有界且只属于当前交付调用

- 状态：accepted
- 日期：2026-08-17

P2C.2 能把 exact Draft PR head 的全部 checks 作为 Goal 完成门，但每次只读取一次。常见结果是 CI 尚未结束，`complete_delivery` 返回 `unknown`，模型再消费一次结果并发起完全相同的调用；这没有增加判断，只增加模型轮次、token 和交付时延。

因此 `dsh-software-delivery` 增加默认关闭的 host 配置 `draftPrCheckWait`。它只在 `requireDraftPrChecks: true` 时有效；一次 active `complete_delivery` 调用完成 local verification、exact push 和 Draft PR 查找后，可在最多 10 秒至 2 小时的静态期限内只读同一 PR。每次读取都重新绑定预先验证的 exact commit；等待后转绿还会重新核对本地 HEAD 与 clean worktree。checks 失败、远端或本地 head 漂移、查询不可信或调用取消立即停止；pending 与尚未出现的 checks 才会等待。超时返回最后一份 bounded `unknown` 证据并保持原生 Goal active。

等待不创建 daemon、Job、watcher、CI journal 或第二个 Goal 状态。进程中断后，下一次调用重新验证本地 Git，并以远端 branch/PR/checks 为幂等事实；不会自动创建第二个 PR。实现不改 `complete_delivery` Tool Schema、Skill 正文或 system prompt，等待期间模型调用为零。

拒绝无上限等待、默认开启、复制 CI 日志、解释 required-only branch protection、自动修 CI、merge/ready、在没有 active Tool 调用时后台轮询，以及为此建设通用 workflow/notification 平台。
