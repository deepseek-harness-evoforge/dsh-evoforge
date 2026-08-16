# P0B.1：Generation Release Kernel 本地证据

> 状态：`implemented`，本地 macOS + pinned DSH 通过；不是完整 P0B、自动晋升、长期运行或 Hermes 上位证明
> DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
> 日期：2026-08-16

## 用户结果

一个已经通过 Shadow/Trial 的 Skill 版本可以先作为 inactive Generation
落盘；只有其 Git commit/tree 和只读物化内容完全匹配时，host 才能把它设为
未来 Session 的 active Generation。当前 Session、resume、child、rollback 和插件
移除都有明确且可测试的语义。

## 实现边界

- 一个 DSH Storage Domain 保存 immutable manifests、active pointer 和 Session pins；
- Generation id 由 canonical JSON 内容计算；写入重试幂等；
- active pointer 只允许 root 或当前 active 的直接 child；rollback 指向精确 parent，root rollback 清空 pointer 并回到原生 DSH；
- root Session pin 当前 active；没有 active 时也持久化原生 DSH pin；resume 复用 lifecycle identity pin，child 继承 parent Session pin；
- exact Git commit/tree 在 pointer 切换前验证；每个普通文件按 Git blob hash 复核；
- scoped Skill Provider 只进入目标 Agent scope，Skill body 和 relative resources 来自只读 cache；
- 物化/完整性失败把该 Session 的 durable pin 降级为原生，修复 cache 并重启也不会让同一 Session 漂移；pin 存储本身失败时，当前进程仍固定原生并明确报告无法持久化；
- 不写私有 Session event，不增加 Evolve Tool 或 system prompt。

## 实际验证

`generation-store.e2e.test.ts` 使用真实 DSH JSON Storage Domain 验证：

- content-addressed Generation、幂等 publish、重启读取和深冻结返回值；
- inactive publish、atomic promotion、parent/root-to-native rollback 和重启恢复；
- native/root/fresh/child Session pin 及 Session id 复用保护；
- Cordis 插件 load/dispose/removal 与 host-only composition 不变。

`generation-binder.e2e.test.ts` 使用真实 DSH Agent、Agent Loop、Skill Registry、
Tool Skill、Session JSONL、Goal 和 fixed LLM Adapter 验证：

- 错误 Git tree 无法移动 active pointer；
- 第一次晋升前已启动的原生 Agent 及其 child 始终保持原生，且两轮请求前缀不漂移；
- 旧 Session 读取旧 body，新 Session 读取新 body，child 继承旧 parent；
- rollback 后的新 Session 回到旧 body，已运行的新 Session 仍保持新 body；
- resume 在 active 已回滚后仍恢复原来的新 Generation；
- reference 文件与 body 来自对应 exact tree；
- Skill consumer 先于 `dsh-evolve` 装配时，首个模型请求已经含固定 catalog；
- promotion 后旧 Session 的 Tool surface 完全相同，后一请求保留前一请求的完整消息前缀；
- Storage pin 写失败时没有 overlay，但原生 assistant response 正常产生；
- cache 损坏时同一 Session 降级为 durable native；修复 cache 并重启后它仍为 native，而新 Session 可使用 exact Generation；
- 删除插件后，native DSH 恢复 assistant history 和原生 Goal objective。

`package-install-remove-generation.e2e.test.ts` 对 `pnpm pack` 的真实产物执行
`dsh plugin add`，从 profile 的 `node_modules` 启动 `dsh-evolve`，再执行
`dsh plugin remove` 并启动原生配置；安装前后的原生 system prompt composition
相同，服务与 scoped 资源没有残留。

`generation-crash-recovery.e2e.test.ts` 使用独立 Node 子进程与 `SIGKILL` 验证：

| 注入点 | 重启后的权威状态 |
|---|---|
| publish 前 | 无 Generation、无 active |
| publish await 完成后 | Generation 完整且 inactive |
| promote await 完成后 | exact Generation active |
| rollback await 完成后 | exact parent active；child manifest 仍可审计 |

这些子进程不调用 `close()`；通过的是底层文件原子写与 fsync 后的真实恢复，
不是优雅退出模拟。

## KV Cache 结论

- 没有 active Generation 时，runtime lane 是 host-only，模型额外 token 为 `0`；
- active Generation 只通过 DSH 原生 Skill catalog/body 进入模型面；
- Generation 在 Session 首步前固定，晋升/回滚不改变 live Session；
- 已跑真实两轮请求的前缀保留断言，但尚未完成长会话 cache-read token/ratio soak，
  因此只标 `implemented`，不标 `verified`。

## 未完成

- proposer、Trial、Candidate 状态机尚未持久化为可 crash-resume pipeline；
- 没有 P0C review/status/promote/rollback command 或 UI；
- 没有 P1 自动晋升、future-session canary 和长期 false-promotion 数据；
- 没有 Linux/Windows Generation assembled lane、多版本 DSH matrix 或第三方复跑；
- 没有真实 provider token/cache 指标和长时 soak；
- npm 未发布，不能作为生产依赖。
