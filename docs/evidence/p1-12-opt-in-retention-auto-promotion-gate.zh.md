# P1.12 Opt-in Retention Auto-Promotion Gate 实现证据

> 声明等级：`implemented`。本页证明 exact P1.11 retention evidence 可选约束既有 clear-win 自动
> 晋升；不声明自动 Case 选择/执行、完整抗遗忘、真实 provider 效果或生产可用。

## 用户断点

P1.11 已能发现“新 Case 变好、旧能力回归”，但 P1.1 自动 policy 只看当前 Shadow。若两者没有机器
可执行的连接，用户仍可能让一个已经有回归证据的 Candidate 自动进入 future Session。

P1.12 只增加一个 opt-in host 配置：

```yaml
autoPromote:
  targets:
    - workspaceId: <workspace-uuid>
      skill: build-dsh-plugin
  retentionRoots:
    - /absolute/path/to/retention-runs
```

没有新 Command、Remote method、Web action、Tool、Prompt、Skill、system message 或 daemon。

## Exact evidence index

`RetentionEvidenceIndex` 对最多 20 个静态 absolute roots 做有界只读扫描：全部 roots 合计最多 200 个
直接 entry，单报告最多 256 KiB，最多投影 20 条不含 host path 的 warning。它验证：

- regular/non-symlink report 与 schema；
- content-derived run id；
- exact source run/recommendation/Skill/baseline/Candidate；
- primary/prior Pack 和 Skill unchanged；
- known-bad fail、known-correction pass、baseline pass、Candidate pass/fail 与 checks 自洽；
- composition stable、sealed Trial ≥ 4、proposer calls = 0；
- 同一 run id 的语义冲突 fail closed；不同 prior Pack 中 `regressed` 优先于 `retained`。

结果只有 `retained|regressed|incomplete|missing`。只有 `retained` 且 warning 为空能满足自动 policy；
其他状态继续使用既有 review，不创建第二个队列。

## 前向纵切

真实 macOS 纵向测试启动 pinned DSH Storage、Evolve plugin 和 late-composed native Jobs：

1. 一个 allowlisted、append-only、sealed `fail → pass` Candidate 已满足全部 P1.1 门；
2. `retentionRoots` 为空时，Control detail 明确显示 missing，active Generation 仍为空；
3. 测试调用真实 P1.11 `evaluateRetention`，对另一个 prior Case Pack 执行四次 macOS Sealed Trial，
   得到 exact `retained` report；
4. 不重启 DSH，同一个 supervisor 下一轮重评、发布 inactive Generation 并自动激活 future Session；
5. 整条 Retention/scan/publish 路径没有新增 Agent model request，原 Skill/Git branch 不移动。

另一条恢复测试构造 crash 后留下的 auto-approved/inactive Generation；policy 重新看到 regressed evidence
后不调用 `promoteGeneration`，证明恢复不能绕过 Retention。P1.1 未配置 roots 的原有自动晋升纵切继续
通过，保持 opt-in 兼容。

## 失败与包边界

自动化还覆盖 missing、only-incomplete、retained、regressed、retained+regressed、source/run-id 篡改、
malformed、symlink 与 duplicate conflict。真实 `pnpm pack` artifact 用包含 `retentionRoots` 的配置完成
DSH profile add/boot/dispose/remove，native composition 保持不变。

关键文件：

- `packages/dsh-evolve/src/retention-evidence-index.ts`
- `packages/dsh-evolve/src/auto-promotion.ts`
- `packages/dsh-evolve/test/retention-evidence-index.test.ts`
- `packages/dsh-evolve/test/generation-binder.e2e.test.ts`
- `packages/dsh-evolve/test/package-install-remove-generation.e2e.test.ts`

本次本地单 worker 全量结果为 `dsh-evolve` 157 passed / 2 skipped；新增 policy/index 单元与真实 DSH
纵切均通过。PA-1 为 Evolve 48/48、Software Delivery 22 passed / 1 skipped、Web 8/8、Telegram
22/22。全仓顺序复跑为 Doctor 5/5、Software Delivery 26 passed / 1 skipped、Telegram 37/37、Web
9/9，全部构建、类型和文档链接检查通过。GitHub Node 22/24 + macOS assembled 结果以本 PR 终态为准。

## KV Cache 与成本

- normal Session：新增模型调用/token/模型可见 surface 均为 0；
- enabled/disabled Retention 配置下，真实 DSH 完整 model request 逐字段相等；
- policy scan 不执行 Trial；只有操作者另行显式运行 P1.11 时产生四次 evaluator execution；
- 不复制 Candidate、Case Pack、反馈、Prompt 或 host path 到 Remote；
- 没有通知中心、Mission、Memory、Case registry、Workflow DAG 或第二个 runtime。

## 仍未证明

- 尚未自动选择或运行 prior Case Pack；当前仍需显式 P1.11 CLI；
- 一个 retained Pack 不是完整抗遗忘，多 Pack 的过期、冲突与 required/all/quorum 语义尚未设计；
- 没有真实 provider 的遗忘率、误阻塞率、净收益与单位 Retention 成本；
- explicit human approve/promote 刻意保留最终授权，不受实验性 auto policy 硬阻断；
- 只有 macOS sealed backend，陌生用户配置、磁盘耗尽与多日 soak 未完成。

契约见 [P1.12](../architecture/p1-12-opt-in-retention-auto-promotion-gate.zh.md)，决策见
[ADR-0032](../adr/0032-retention-evidence-is-an-opt-in-auto-promotion-gate.md)。
