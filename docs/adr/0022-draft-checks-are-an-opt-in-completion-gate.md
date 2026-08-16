# ADR-0022：Draft PR checks 是可选的完成门

## 状态

Accepted，2026-08-16。

## 背景

P2C.1 能确认 exact commit 已推送且同一个 GitHub Draft PR 存在，但 PR 创建成功不代表远端
CI 已经通过。若仓库把 Draft PR 作为交付物，Agent 在 checks 仍 pending、失败或根本未注册时
完成原生 Goal，会把“已送审”误报成“已验证交付”。

直接增加 CI watcher、后台 daemon、publication journal 或新的 `wait_for_ci` Tool 会复制 GitHub
已经拥有的状态，扩大常驻复杂度和模型表面，也会降低 DSH 的 KV Cache 命中稳定性。

## 决策

`dsh-software-delivery` 增加 host-side、默认关闭的 `requireDraftPrChecks` 配置。它不改变
`complete_delivery` 的名称、描述、参数 Schema 或 Tool 顺序。启用后，同一次原子完成路径在
确认 exact Draft PR 和本地 post-state 后，通过原生 `bash/pwsh` Tool 执行一次：

```text
gh pr view <exact-url> --json headRefOid,statusCheckRollup
```

结果按三态归一：

- exact head 且至少一项 check，全部 `SUCCESS`、`NEUTRAL` 或 `SKIPPED`：`passed`，允许调用
  原生 `update_goal complete`；
- 任一 check 失败、取消、超时、action-required、startup-failure 或 stale：`failed`；
- 无 check、仍 pending/expected、head 不一致、查询失败或响应不可解析：`unknown`。

`failed` 与 `unknown` 都保持 Goal active。插件不等待、不轮询；用户或 Agent 稍后重试同一个
`complete_delivery` 即可。每次重试重新验证本地 exact commit/check，再非强制 push、复用同一个
Draft PR 并读取远端当前事实，因此无需第二份 journal 或恢复进程。

## 结果

- 用户可选择“创建 Draft 即完成”或“exact Draft checks 全绿才完成”；默认行为保持兼容。
- 无新增 Tool、Prompt、Skill 或动态 Schema；开关只影响 Tool 被调用后的 host 执行。
- `statusCheckRollup` 和 exact `headRefOid` 是事实源；无 check 不能被误判为绿色。
- 结果只暴露 passed/pending/failed 计数与原因，不下载 CI 日志，不把动态 check 名称放进模型
  Schema 或常驻 Prompt。
- 所有 GitHub 读取仍通过 DSH 原生 shell policy；merge、ready、release、deploy 等权限不变。
- 当前只覆盖 GitHub.com 同仓 Draft PR 的全部 rollup checks；不声明 required-only 规则、fork、
  GHES、其他 forge、后台等待或 CI 日志诊断。

