# P2C.3 Bounded Draft Check Wait 契约

> 状态：implemented；真实公开 Draft PR pending→green gate 与多日生产数据仍需验证

## 用户痛点

软件交付 Agent 已经创建 exact Draft PR 后，CI pending 并不需要新的模型判断。P2C.2 的单次读取会让 Agent 消费一次 `unknown`、重新运行相同 Tool，再查询一次；长 CI 会浪费轮次和 token，也让一个本可自主完成的 Goal 停在机械等待上。

## 最小行为

部署者必须同时配置：

```yaml
config:
  requireDraftPrChecks: true
  draftPrCheckWait:
    timeoutMs: 1800000
    pollIntervalMs: 15000
```

`draftPrCheckWait` 存在时：

1. `complete_delivery` 仍先核对 exact Goal revision、linked worktree、local checks、commit、push 和 Draft PR；
2. push、PR list/create/read-back 与本地 post-state 每次调用至多执行原有次数；
3. 只对 `checks-pending` 或 `checks-missing` 等待；每次 poll 都读取 `headRefOid/statusCheckRollup`；
4. exact remote head 全绿后再次核对 local HEAD 与 clean worktree，仍相等才调用原生 `update_goal complete`；
5. failed、remote/local head drift、dirty worktree、malformed、unreadable、native policy denial 或取消立即停止；
6. deadline 到达返回 `unknown/checks-timeout` 和最后一份 bounded counts，Goal 保持 active；
7. 进程退出或调用重试时，GitHub 事实源允许复用同一 Draft PR；不持久化第二份 CI 状态。

默认 timeout 为 30 分钟，允许 10 秒至 2 小时；默认 poll 为 15 秒，允许 1 秒至 5 分钟且不得超过 timeout。未配置时完全保持 P2C.2 单次读取语义。配置 wait 但没有开启 `requireDraftPrChecks` 会在启动时明确拒绝。

## Cache 与 token

- 不新增或修改 Tool 参数、Tool 描述、Skill 正文、Prompt 或 Tool 顺序；
- host 配置开关前后的 `complete_delivery` 完整 Schema 必须逐字段相等且继续 `≤ 2 KiB`；
- wait 期间模型调用为 `0`，因此 pending→green 不需要额外 Agent turn；
- Tool 最终只返回已有 PR artifact 与三态计数，不复制 check 名称、日志或动态进度；
- 普通 Session、未调用交付 Tool 的 Session 与本功能关闭时 token 增量为 `0`。

## 权限与失败语义

轮询是通过既有 DSH native shell policy 发起的只读 `gh pr view`。push/Draft PR 仍属于已授权交付动作；merge、ready、release、deploy、secret read、付费及不可逆动作均未增加。查询不可信时不把未知冒充失败或成功。取消传播给等待和 native shell；超时不自动扩大预算。

## 非目标

required-only 规则、CI 日志诊断、自动修复、fork/GHES/其他 forge、多 PR workflow、后台 watcher、通知中心、持久队列、自动 merge 和通用 CI 平台均不进入 P2C.3。

实现取舍已经并入本页；旧 ADR-0038 只在 Git 历史中保留。
