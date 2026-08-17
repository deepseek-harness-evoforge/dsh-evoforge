# ADR-0013：受验证完成委托给原生 Tool

## 状态

Accepted，2026-08-16；standalone CLI 保留条款于 2026-08-17 被 [ADR-0041](0041-dsh-is-the-only-runtime-and-install-surface.md) 撤销，原生 Tool 决策继续有效。

## 背景

P2A.1 已能证明一个 linked worktree 的 exact commit 和 repository checks 是否通过，但
“先运行 CLI，再单独调用 `update_goal complete`”仍有竞态：模型可能使用陈旧 Goal revision，
也可能在检查失败后误报完成。

DSH `GoalService.complete()` 当前没有受支持的 pre-complete 扩展点。全局 monkey-patch、替换
Goal Service 或拦截所有 Goal transition 会影响非软件交付 Goal，并引入第二套 policy。另建
Mission、DAG 或交付状态机同样超过这个用户问题所需的复杂度。

## 决策

`dsh-software-delivery` 增加一个固定 Schema 的 `complete_delivery` Tool：

1. 在任何 check 前核对 calling Agent 的 exact native Goal id/revision；
2. 只读核验 named linked worktree、base、HEAD、commit count 和 clean 状态；
3. 通过嵌套原生 `bash`（Windows 为 `pwsh`）Tool 执行 exact argv，使已有 sandbox、approval、
   Tool guard、取消和输出策略保持权威；
4. checks 全部通过且 Git 状态未漂移后，嵌套调用原生 `update_goal complete`；
5. `failed` 或 `unknown` 返回有界证据并保持 Goal active。

Tool 只在 Goal、Tools、原生 `update_goal` 与平台 shell 都可用时注册；依赖丢失或插件卸载时
自动撤销。本 ADR 当时还决定保留 standalone CLI，供无完整 Agent composition 的可信本地调用；
该入口后来由 ADR-0041 撤销，binary 已删除。当前唯一受支持的用户路径是在 DSH Goal 中按需加载
`software-delivery` Skill，并由 Agent 调用 `complete_delivery` Tool。

## 结果

- 没有第二个 Goal、持久化、调度器、policy 或 system prompt；原生 Goal 仍是唯一事实源。
- 软件交付获得一个原子的推荐完成路径，但不全局禁止人类或其他原生调用直接完成 Goal。
- Tool surface 增加一个稳定 Schema；测试限制其序列化 JSON 不超过 2 KiB，并证明同一 Session
  的重复请求完全相等。Skill 正文仍按需加载。
- 集成 checks 的权限由原生 shell Tool 决定；插件不会用自己的 process runner 绕过 policy。
- push、Draft PR 和 Evolve outcome 消费仍是独立后续结果，不塞入这个 Tool。

若真实误完成数据证明推荐原子动作仍不足，才向 DSH 上游讨论正式 pre-complete seam；本插件
不会先用全局 patch 模拟该 seam。
