# P2C.2 证据：exact Draft PR checks 完成门

> 日期：2026-08-16  
> 声明等级：`implemented`；GitHub.com 同仓 Draft PR 的 opt-in 单次远端门，不是 CI watcher

## 用户结果

开启 `requireDraftPrChecks` 后，`complete_delivery` 不会因为 Draft PR 已存在就提前完成原生
Goal。它必须确认远端 checks 属于本次 exact commit，且至少一项 check 全部结束并通过。
pending、失败、缺失、head 漂移和查询不确定都保持 Goal active；稍后重试复用同一个 PR。

## Test-first 行为证据

红灯首先证明 P2C.1 会在 Draft PR 存在但 CI pending 时完成 Goal。绿色实现固定覆盖：

- pending → `unknown/checks-pending`，Goal active；
- failure → `failed/checks-failed`，Goal active；
- empty rollup → `unknown/checks-missing`，不会把“没有 CI”当作通过；
- wrong `headRefOid` + green rollup → `unknown/checks-head-not-confirmed`；
- exact head + 全绿 → `passed`，随后才调用原生 `update_goal complete`；
- pending、failed、missing、green 连续重试始终复用同一个 Draft PR，不执行第二次 create；
- 配置关闭与开启时 `complete_delivery` 的完整 Tool Schema 相等，重复请求 Tool 数组相等。

状态解析同时覆盖 GitHub CheckRun 与旧式 StatusContext；成功、neutral、skipped 视为通过，
pending/expected 视为未决，failure/error 及 GitHub 的失败终态视为失败。不可解析状态 fail closed。

## Cache、复杂度与权限

- 配置是 host plane 的静态布尔值，默认关闭；没有新增模型 Tool、Prompt 或参数。
- 完整 Tool Schema 继续通过 `≤ 2 KiB` serialized JSON gate；普通 Session 和未调用 Tool 的
  token 成本不变。
- 每次调用只读取一次远端事实，不轮询、不启动 daemon、不持久化第二份 CI 状态。
- 返回值只增加 bounded 三态计数，不复制 check 日志、PR 正文、凭据或动态 check 名称。
- `gh pr view` 继续通过原生 shell Tool；现有 sandbox、approval 和 Tool guard 保持权威。
- merge、ready、release、deploy、secret read、付费及不可逆动作没有增加。

## 验证结果

- `pnpm check`：`dsh-evolve` 116 passed / 2 skipped；`dsh-software-delivery` 26 passed /
  1 skipped；合计 142 passed / 3 skipped，typecheck、build 与 docs 全绿。
- exact feature commit：`e12c62df68a5456d046516578b275fe02f1b0a96`。
- GitHub Actions run `31952683662`：Node 22、Node 24 与 macOS assembled 三项全绿。
- 真实已登录 live gate：对
  [Draft PR #7](https://github.com/deepseek-harness-evoforge/dsh-evoforge/pull/7) 执行 exact
  非强制 push、复用、head read-back 和 checks rollup；三项 CI 全绿后测试 `1 passed`，没有
  创建第二个 PR，也没有改变 Draft/ready/merge 状态。

## 边界

该开关不自动等待 CI。若调用发生在 checks pending 时，Agent 获得 compact `unknown`，原 Goal
继续 active；下一次重试重新运行本地验证并读取同一 PR 的新状态。当前读取全部 rollup checks，
不解释 GitHub branch protection 的 required-only 集合，也不下载失败日志。fork、GHES、其他
forge、CI 故障诊断和生产长时重试不在本片范围。

设计取舍见 [ADR-0022](../adr/0022-draft-checks-are-an-opt-in-completion-gate.md)。

