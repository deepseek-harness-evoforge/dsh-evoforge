# V5.232：Interaction Session 双 persistence reader

日期：2026-09-11。这个证据只覆盖 Interaction evidence resolver 的物理 Session 读取接缝，不把 current DSH
升级为完整 supported runtime，也不表示运行中的产品已经自动创建完整 Interaction Episode。

## 固定对象

- DSH alpha.5：clean `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` / `dsh-v0.1.2-alpha.5`；
- DSH current：clean `c291e7961a515f6d7af9304e7fd1d257929aef26` / CLI `0.1.5-rc.2`；
- EvoForge 基线：`aba9f6256a4e464fe9374395fe6ea2dd68bc62b9` 加本轮未提交 diff；
- 两个 DSH checkout 均为独立、clean、已完成 frozen install 与官方根 build 的源码树。

## 本轮合同

resolver 继续先固定 live Session、目标 `turn/end` 与完整前缀，等待 `sessions.flush() === true`，再通过一个内部
reader 做物理 readback。reader 对 runtime capability 做一次 exact XOR 选择：

- alpha.5 只能有 `readFrom`，调用 `readFrom(sessionId, 0, signal)`；
- current 只能有 `open`，调用 `open(sessionId, 'read', { signal })`，验证 read handle 的 id、access、header、
  inherited count、`read` 与 `close`，再调用 `read(0, capturedEventCount, { signal })`；
- current fulfillment 必须是只有 `eventState` 与 `events` 的 plain data record，state 只能为 `detached` 或
  `shared-frozen`，返回长度不能超过请求上限；
- 同时出现两种 capability、两者都缺失、非函数 capability、错误 handle、未知 state、装饰/hostile fulfillment
  或不可 clone 数据全部 fail closed。

物理 reader 的默认 deadline 为 30 秒，测试 seam 只允许 `1..120000` 毫秒。timeout 或 owning Cordis
fiber dispose 会在发布 deadline rejection **之前同步 abort** 传给后端的 `AbortSignal`；迟到的 current handle 不再开始 read，但仍会被
观察并 exactly-once close。已经拿到 handle 的 pending read/close 也受同一个 deadline；read 成功后的 close 必须完成，
否则结论是 `stored-read-failed`。若 read 本身失败，primary read error 的 taxonomy 不会被同时发生的 close error 覆盖。
NotFound/unsupported/corruption 只在真实 read/open 失败处细分 abstention；伪装成这些名字的 close failure 不能被洗成
“没有 cut”或“cut 冲突”。

两个已审计 physical codec 都会把 header 中缺席的 `delegationDepth` 写成 `0`。verifier 只对 Session format
v0/v3 的这一对等价表示做比较；任何非零或其他 header 漂移仍是 conflict。等价成立后，projector source 与 Host subject
都使用 resolver 起点冻结的 logical live header，而不是 codec 展开的表示，因此 completion-time Generation/Routing
receipt 的 prefix/lifecycle identity 不漂移。

## 回归结果

关键命令使用一个 worker，并在同一 EvoForge working tree 下分别设置 exact source selector。文件清单与
[V5.231 的 exact 20-file selector](v5-231-session-v3-direct-turn-attestation-2026-09-11.zh.md)相同：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<clean-dsh-source> \
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

结果：

- lifecycle deadline、resolver、Gateway-aware resolver 与 Gateway contract：4 files / 185 tests passed；
- source-aware Generation binder：alpha.5 6/6，current 6/6。首个正例挂载真实 JSONL persistence，关闭 EvoForge
  producer 完成 ordered drain 后，重新打开真实 Generation/Routing vault；physical resolver 的 Host abstention 不再缺
  `generation` 或 `routing`，因此同时验证了物理 read、logical header identity 和 durable receipt match；
- 同一 20 文件 selector：alpha.5 501/501，current 501/501；
- `dsh-evolve` 全量 alpha.5：80 files / 954 tests passed；
- `dsh-evolve` 全量 current：75 files / 948 tests passed，另有 5 files / 6 tests 仅因 Case Pack 仍 exact-pin
  `db6bdc…` 而按预期失败；没有新增 current-only regression；
- `dsh-evolve` Host/test typecheck 与 build 通过，diff check 通过。

测试还覆盖：timeout 后 late open/read/close settlement、同一 Cordis owner 的 dispose/open microtask 竞态、invocation 与
dispose 的双向发布顺序、close hang、wall-clock rollback、read 与 close 双失败、teardown 私有错误不进入 Cordis logger、
method accessor 不被调用、官方 error 从错误阶段抛出、inactive lifecycle、null/hostile/decorated-array metadata、错误
id/access/count、oversized slice、v0/v3 root depth 默认值及真实非零 header drift。独立 adversarial/design review 在稳定实现上
均未发现 reader release blocker。

## 不能外推的结论

- deadline 从物理 reader 开始，不包含它之前的 `sessions.flush()`；当前不能称整个 durability resolution
  end-to-end bounded；
- cross-copy DSH error name 只用于细化 fail-closed abstention taxonomy，不是身份验证或 positive authority；
- resolver factory 仍是内部 trusted-composition seam，运行插件尚未自动消费它或写完整 Episode；
- current Gateway handle read-result 适配、durable feedback attribution 的旧 `inspect` seam、retry/replacement/
  compaction/PTC cohort、11 个包的依赖与 Case Pack/lock/CI pin 仍需后续迁移；
- 因此完整支持组合继续固定 alpha.5；current 结论只是 latest audited、buildable，并通过 direct-turn projector 与本轮
  dual persistence reader 的局部 assembled cohort。
