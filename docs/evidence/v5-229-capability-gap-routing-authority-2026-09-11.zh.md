# V5.229：Capability Gap Routing 与 authoring qualification

- 日期：2026-09-11
- EvoForge 基线：`f1d17697188e5517578ea4004115455beba36722`；实现与本文位于同一后续提交。
- 已验证 DSH：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`0.1.2-alpha.5`）。
- 证据范围：本地源码、真实 alpha.5 Agent/Session/Tools/Skill seam、Storage Domain 合同和确定性 assembled
  fixture；不含真实 Provider、渠道消息或 Hermes paired 运行。

## 本轮闭合的边界

- 只有 EvoForge 自有 `report_capability_gap` 的 exact registration、模型可见 schema、registry-minted execution、
  实际 body 进入与返回、最终 Tool success、durable Session result 和 completed turn 能形成 raw-free Routing receipt。
  shadow、registry mutation、pipeline 外直接 captured-body 调用、取消、错误、重复/乱序、result rewrite、Workspace
  漂移和 lifecycle/HMR 跨 epoch 均 fail closed。
- Skill catalog 的 pre-step 观察失败会撤销当前 Session 旧图；任意 `skills/change` 会同步撤销该 mount 的全部旧图，
  catalog epoch 和 observation token 阻止在途旧 snapshot 重新发布。下一次成功 pre-step 才能恢复资格。
- Goal-linked model-declared Gap 先以 legacy v1 行保持 provisional。只有同一 completed owned turn 写入单独的
  `completed-owned-gap-turn-v2` sidecar 后，才可进入 opportunity、evaluation seal 和 restart reconcile。sidecar
  内容寻址并绑定完整 Gap digest、Workspace、Session、requested Skill、Goal id/revision 与 Routing provenance；
  orphan、转移、tamper、quota prune 失败和 downgrade projection 均不能放大权限。
- Generation 与 Routing vault 使用独立的 default-deny policy、quota 和 sticky conflict/unavailable 状态；Host resolver
  并发读取各 source，先处理冲突，只关闭相应证据维度。当前插件仍没有自动消费这些 source 的完整 Episode composer。
- 普通 native `skill` error 无法区分缺失、policy、加载、取消和执行失败，因此 native monitor 已撤下；历史
  `native-skill-miss` 行保持可读，但不再有 authoring/evaluation 权威。
- RP-1 epoch 2 只保留 byte-exact manifest 和五条 qualified Gap fixture 形成一个 Opportunity 的确定性合同。由于
  DSH ignored build artifact、实际 Provider 配置、终态 revision、失败输出和缓存 artifact 尚未形成同一次运行的可审计
  绑定，当前 paid runner 被硬阻断；精确批准也在读取 Provider 配置或私有路径之前固定失败。

## 验证结果

对固定 alpha.5 source 运行 18 个 Routing/qualification/Generation/resolver/governance 相关文件：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-alpha5> pnpm --filter dsh-evolve exec vitest run \
  test/capability-gap-routing-evidence.test.ts test/capability-gap-store.e2e.test.ts \
  test/capability-map.test.ts test/config-contract.test.ts test/evolution-control-plane.test.ts \
  test/gateway-ingress-evidence-resolution.contract.test.ts \
  test/gateway-aware-interaction-episode-evidence-resolver.test.ts test/generation-binder.e2e.test.ts \
  test/interaction-episode-evidence-resolver.test.ts test/interaction-generation-evidence.test.ts \
  test/interaction-routing-evidence.test.ts test/lifecycle-deadline.test.ts \
  test/skill-candidate-evaluation-flow.test.ts test/skill-evaluation-envelope.test.ts \
  test/skill-evaluation-evidence-vault.test.ts test/skill-evaluation-governance.test.ts \
  test/skill-opportunity-discovery.test.ts test/slow-loop-skill-authoring.test.ts --maxWorkers 1

18 files / 339 tests passed
```

RP-1 当前入口的类型和合同检查：

```text
pnpm benchmark:provider:rp1:check

typecheck passed; 15/15 tests passed
```

其中 epoch 2 为 7/7：直接 runner 无批准时 `not-run` / exit 2；精确批准时
`paid-provider-execution-blocked:runtime-attestation-incomplete` / exit 1，并证明十个 Provider/private-path 环境名均未被读取。
发布入口 `pnpm benchmark:provider:rp1` 也有合同覆盖：pnpm 将 child exit 2 折叠成顶层 exit 1，但 JSON 仍为
`not-run`，输出保留 child exit 2；因此这两个状态必须按 JSON 区分。
这不是 paid pass，也没有发起外部请求。其余 8 个测试只保留 epoch 1 的历史 contract 边界。

`pnpm typecheck && pnpm build` 在 12 个 workspace package 上通过。`check:dsh:preflight` 对上述 exact alpha.5
通过；latest-audit 单测、文档、CI 路径、15 个 suite/installer 合同、release gate/tag/workflow/name/tag-script 单测和
DSH compatibility-script 单测均通过；`git diff --check` 通过。

默认 `pnpm --filter dsh-evolve test` 的结果为 815 passed / 7 failed / 1 skipped。七个失败与本轮 Routing 无关且与
既有外部阻断一致：六个 assembled 测试读取 canonical 本地 DSH `5dda764ed3aa172535a7967b06ff95d9cbfe536a`，
而 Case Pack 固定 alpha.5 `db6bdc…`；另一个 latest native Workspace profile 缺少上游
`@deepseek-ai/node-addon-landlock-run`。因此不能把默认全量命令记录成全绿。

## 未完成与禁止外推

- alpha.5 ToolRuntime 不提供 dispatcher-selected definition token 或内部 `bodyInvoked` 证明；当前 Producer 对
  registry execution/body/final/turn 做了最强可见绑定，但文档所述无 registry mutation 的特殊 downstream
  captured-body wrapper 仍是版本能力上限。
- alpha.5 Storage Domain 对已接受的写入没有 abort/deadline/no-late-write fence；读取有 30 秒 fail-closed deadline，
  durable write teardown 仍可能等待 Provider settlement。这继续是 release blocker。
- Routing 只闭合 Episode 的一个维度，不证明 capability winner、Generation、模型、权限、sandbox 或完整 composition；
  尚无唯一 Host composer 自动消费 Gateway/Generation/Routing source，也没有让普通 no-Goal Interaction 贯通慢环。
- 当前远端 DSH master/tag 已越过本次验证版本；最近完成的源码适配审计只到 `0.1.5-alpha.2`，不能把这里的 alpha.5
  结果外推到 latest。
- 没有真实双 Provider、Feishu/Telegram 长期消息、真实用户效果、负迁移/遗忘/误晋升测量或同条件 Hermes paired；
  本证据不能支持发布、稳定性或“整体上位替代”声明。
