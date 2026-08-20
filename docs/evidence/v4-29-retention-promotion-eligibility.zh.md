# V4.29 exact Retention → future-Session Promotion Eligibility 证据

> 声明等级：`implemented`。本证据证明 Command 与 Web 的 future-Session 晋升已由同一 Host gate 约束，只有 exact retained Candidate 才可写 active Generation selection；它不证明自动晋升、canary、真实 provider outcome、最终 tarball 浏览器或 Hermes 上位替代。

## 修复的生产断点

审计发现 `/evolve promote <generation-id>` 与 `EvolutionControlPlane.promote()` 会直接调用 `EvolutionStore.promoteGeneration()`。因此一个已发布为 inactive 的 Generation 即使没有 Retention、Retention 为 `regressed`/`incomplete`、或证据谱系错配，仍可被人工激活。

TDD 红测分别固定了四个旧行为：

- Control Plane 在没有 eligibility governance 时仍返回成功并调用 store；
- `/evolve promote` 在没有 governance 时仍返回成功；
- `configuredRootCount = 0` 却投影 retained run 的矛盾输入仍会晋升；
- DSH Web 对 regressed Generation 不显示原因且仍允许点击 Promote。

## 当前活动合同

- `FutureSessionPromotion` 是唯一可从 Command/Web 到达的 Generation selection authority；Retention、Shadow、Review 和 Candidate Lineage 继续保持 `releaseAuthority: none`。
- 每次 eligibility 或 promote 都重读 exact Generation、approved Review、Skill Bundle artifact、Candidate Lineage 与 Retention owner projection。
- Workspace、Generation id、review/generation 绑定、Skill、Candidate、Admission、Envelope、Shadow run、baseline tree、Candidate tree、evaluator、composition 和 terminal evidence 必须一致。
- `retention-not-run` 与 `retention-prepared` 为 `waiting`；扫描告警、零 root 却有 run、重复结果、归属/谱系错配、`regressed`、`incomplete` 和 retained verdict/evidence 脱钩为 `blocked`。
- 只有唯一、结构完整、baseline pass、Candidate pass、calibration pass、composition stable、proposer calls 0、trial count 4 的 `candidate-retained-prior-case` 为 `eligible`。
- Command 与 Web Remote 都消费同一个 Host 实例；生产源码中的直接 active-selection 写入只剩 gate 下方的 `VerifiedEvolutionStore`。
- DSH Web 显示 `eligible / waiting / blocked`、具体原因与 bounded Retention id，非 eligible 按钮 disabled；浏览器不接收 Host path、Case、provider、proposal 或 Skill body。
- Promotion 仍只改变同 Workspace 未来 Session 的 active selection；既有 Session pin 与 rollback 语义未改变。

## 已执行验证

Typert 契约使用固定 DSH `47f943859bef60e4160492346772ded9b24f765a` 重新生成：

```sh
DSH_SOURCE_ROOT=/absolute/path/to/pinned-deepseek-harness pnpm generate:typert
```

`dsh-evolve`：

```sh
pnpm run typecheck
pnpm run test
pnpm run build
```

结果：50 files passed、1 skipped；192 tests passed、1 skipped；Typert freshness 与 Node artifact verifier 通过。

`dsh-evolve-web`：

```sh
pnpm run typecheck
pnpm run test
pnpm run build
```

结果：2 files / 19 tests passed；Client 与 Host bundle 构建、Node artifact verifier 通过。

仓库根门禁：

```sh
pnpm check
```

结果：完整 workspace 串行检查退出码为 0（`ROOT_CHECK_EXIT=0`）。

## 未完成门禁

- 从最终 tarball 安装到 clean profile 后，以真实 DSH 浏览器复验 eligible、blocked、刷新、Host 失败和恢复；
- counterfactual canary、持续 outcome、误晋升监测与自动 rollback eligibility；
- 两套独立真实 provider 的 admission→holdout→Retention→Promotion 整链；
- existing-Skill 完整 baseline Bundle/Candidate；
- 真实飞书 exact route 与同条件 Hermes paired benchmark。

因此本增量不创建 tag，不发布 v0.1，也不声称自我进化或 Hermes 上位替代已经完成。
