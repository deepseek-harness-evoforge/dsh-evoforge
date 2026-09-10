# V5.231：Session v3 普通 direct-turn 证据

- 日期：2026-09-11
- EvoForge 基线：`8fbcb2ace6c34f93374276690c39babb988f9b2d`；实现、测试与本文位于同一后续提交。
- DSH current：clean `c291e7961a515f6d7af9304e7fd1d257929aef26` / CLI `0.1.5-rc.2`，与
  `origin/master` 一致。
- DSH 回归基线：clean `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` / `dsh-v0.1.2-alpha.5`。
- 范围：本地源码、真实 DSH AgentLoop/Session/Goal/Tool 与 Storage Domain；没有真实渠道、真实 Provider、
  Hermes paired、长期 soak、registry 或发布验证。

## 闭合的边界

Interaction transcript reader 现在显式区分 Session format v0 与 v3。v0 行为保持不变；v3 只接收 human-first、没有预排
`next-step` inject/steering context 的 settled direct AgentLoop turn，并执行以下 fail-closed 检查：

- 顶层事件坐标、turn/step、System/User/Assistant/Tool 因果结构和 exact request route；
- compact Assistant stream 的 exact record keys、时间/index/delta、block grammar、usage 和显式成功 finish；current adapter
  合法的 raw Tool-call provisional 空 id/name 可以出现，但最终 block/message identity 必须非空且完全一致；
- 重新 assembly 的 content、usage 与 replay state 必须和 durable `assistant/message` 完全一致；
- v3 System prompt 只接受 AgentLoop 固定 `@deepseek-ai/dsh-system-prompt` source 的 empty/单个非空 text `system/message`；
  首个 surface 必须是请求输入之前建立的受保护 System head；本 cohort 的后续非空 append 只能位于继承 request header
  的后续 step 请求之前、不能重复当前有效 prompt，且 effective route 必须声明 `systemPromptUpdate: in-history`；tail
  存活后每个后续请求都必须继续继承 header 并保持该 route 能力；拒绝 retired
  `request/header.system`，并把 request context 纳入 logged-control digest；
- dialect 与 logged-control digest 进入 qualification、Generation/Routing receipt identity；digest 也随 raw-free fact 到 Host
  composer 做 exact match；旧 digest-less receipt/qualification 行继续可读和可审计，但不能命中 current query，也不能授予
  authoring/evaluation 权威。

reader 扫描从 Session 开头到目标 `turn/end` 的整个前缀。v3 `assistant/attempt`、`llm/retry`/`llm/retry-started`、surface
replacement、全部 `compaction/*`、PTC dispatch、顶层 legacy chunk/citation、unknown/mixed/malformed stream 全部 abstain；
未知 required 事件也 abstain，只有明确 `ignorable: true` 的未知事件可以跳过。这里的 `sourceDialect` 是 reader semantics，
不是对任意历史 DSH revision 的证明。

## 双 source-selector 回归与 current-backed 路径

分别以上述两个 clean、已构建 DSH checkout 作为 `DSH_EVOLVE_DSH_SOURCE_DIR`，运行相同的 20 文件回归选择：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<exact-dsh-source> \
  pnpm --filter dsh-evolve exec vitest run \
  test/capability-gap-routing-evidence.test.ts test/capability-gap-store.e2e.test.ts \
  test/capability-map.test.ts test/config-contract.test.ts test/evolution-control-plane.test.ts \
  test/gateway-ingress-evidence-resolution.contract.test.ts \
  test/gateway-aware-interaction-episode-evidence-resolver.test.ts \
  test/generation-binder.e2e.test.ts test/interaction-episode-evidence-resolver.test.ts \
  test/interaction-episode-projector-session-v3.test.ts \
  test/interaction-generation-evidence.test.ts test/interaction-routing-evidence.test.ts \
  test/interaction-trigger-request-control.test.ts test/lifecycle-deadline.test.ts \
  test/skill-candidate-evaluation-flow.test.ts test/skill-evaluation-envelope.test.ts \
  test/skill-evaluation-evidence-vault.test.ts test/skill-evaluation-governance.test.ts \
  test/skill-opportunity-discovery.test.ts test/slow-loop-skill-authoring.test.ts --maxWorkers 1
```

稳定结果在两个 selector 下均为 20 files / 448 tests passed。这里不能把整个选择称为“在两个 runtime 下执行”：大多数单元测试仍链接 EvoForge manifest
固定的 alpha.5 peer/dev dependency。真正切换 source checkout 的 assembled 路径是 `generation-binder.e2e` 与
`capability-gap-store.e2e`；前者在两边都是 6/6，current 首个正例令 fixture adapter 显式返回
`systemPromptUpdate: in-history`，并完成 model-declared Gap、completed-turn qualification、dispose/reopen 后的
Generation/Routing match；alpha.5 同一测试保持 format v0 与顶层 chunk 路径。其余选择证明本轮 reader、identity、vault、
resolver 与 governance 静态回归，不应被外推成 current runtime 覆盖。

完整 `dsh-evolve` 包也分别在两个 source selector 下执行；同样只有 source-aware assembled cases 真正替换 checkout，
静态单测仍使用 package-pinned alpha.5 dependency。alpha.5 selector 为 80 files / 901 tests 全通过；current selector 为
75 files / 895 tests 通过，另有 5 files / 6 tests 因 Case Pack 仍 exact-pin `db6bdc…` 而按预期失败。失败输出明确显示
current `c291e796…` 与 Case Pack revision 不匹配；这些结果证明回归与 fail-closed selector 行为，不代表整包已迁移到
current。`dsh-evolve` typecheck 与 build 另行通过。

## 尚未关闭

- Interaction evidence resolver 仍依赖 alpha.5 `SessionPersistence.readFrom`；current handle API 尚未进入该权威 source。
- retry attempt、replacement、compaction 与 PTC 是明确 abstain 的未支持 cohort，不是通过用例。
- 11 个包的 peer/dev dependency、lockfile、Case Pack、CI 和兼容矩阵仍固定 alpha.5。
- 本证据没有改变公开 supported runtime，也没有补齐 Web reload/browser、真实 Feishu/Telegram、真实 Provider、
  进化长期效果、Hermes paired 或 release gates。
