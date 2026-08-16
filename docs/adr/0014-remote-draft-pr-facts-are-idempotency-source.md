# ADR-0014：远端 Draft PR 事实作为幂等源

## 状态

Accepted，2026-08-16。

## 背景

用户默认允许 feature branch push 和创建 Draft PR，但不允许 merge、release 或把 PR 转为
ready。网络请求可能在远端成功后丢失本地响应；如果 Agent 盲重试 `gh pr create`，会产生重复
外部对象。为一个 Git push/PR 流程另建 journal、队列和发布状态机会提高常驻复杂度，也会与
Git/GitHub 已有事实重复。

P2B.1 已有一个稳定 `complete_delivery` Tool。另加 `push_delivery`、`create_pr`、`check_pr`
多个模型 Tool 会扩大缓存表面，并让模型重新承担正确编排。

## 决策

继续使用同一个 `complete_delivery` Tool，增加可选、固定结构的 `draft_pr` 参数。顺序固定为：

1. exact Goal/Git/check 验证；
2. 通过原生 shell Tool 检查 base branch 格式并执行 `gh auth` preflight；
3. 非强制 push exact commit 到 `origin` 的同名 branch；
4. 查询 exact head/base 的 open PR；已有 Draft 且 commit 相等则复用；
5. 否则创建 Draft，并立即 read-after-write 核对 Draft/head/base/commit；
6. 再核对本地 HEAD 与 clean 状态；
7. 全部通过后才调用原生 `update_goal complete`。

任何可能已发生远端写入的非零或不可解析结果都返回 `unknown` 并保持 Goal active。下一次调用
重新验证并先查远端事实。已经由人工转为 ready 的 PR 返回 `failed`，插件不修改其状态。

P2C.1 限定 GitHub.com、`origin`、同仓 branch；不抽象 Forge Provider。出现第二个真实 forge
或 fork workflow 前，不建立公共发布接口。

## 结果

- branch ref、PR head/base/draft/commit 是幂等事实源；无第二个 journal/database/recovery daemon。
- 没有第二个 Tool；加入可选字段后完整 Tool Schema 仍由测试限制为 `≤ 2 KiB`，同 Session 不变。
- 所有 push/`gh` 命令经过原生 `bash/pwsh` Tool，DSH sandbox/approval/guard 继续权威。
- 不使用 force push，不 merge、不转 ready、不编辑已有 PR、不请求 reviewer/label/project。
- 创建响应丢失可安全重试，但网络不确定时不会虚假完成 Goal。
- 版本回滚不能撤销已经推送的 branch 或 Draft PR；插件只保证重试不重复，外部删除仍由人类决定。
