# P1.11 Exact Candidate Retention Gate 契约

> 状态：历史实现契约；standalone Interface 已由 [ADR-0041](../adr/0041-dsh-is-the-only-runtime-and-install-surface.md) 撤销，exact Retention primitive 保留在 `dsh-evolve` Bundle 内

## 唯一用户结果

> 对一个已通过新 Case 的 exact Shadow Candidate，用另一个以前可信的 Case Pack 证明它保留旧能力，
> 或明确指出回归；全程不再请求 proposer、不修改 active Skill。

## 当前原生 Interface

```yaml
- id: evoforge-evolution
  name: dsh-evolve
  config:
    autoPromote:
      targets:
        - workspaceId: <workspace-uuid>
          skill: exact-skill-name
      retentionRoots: [/absolute/owned/retention-runs]
      retentionTargets:
        - id: trusted-prior
          workspaceId: <workspace-uuid>
          skill: exact-skill-name
          casePackDir: /absolute/private/prior-case-pack
          casePackHash: <64-char-hash>
          runRoot: /absolute/owned/retention-runs
```

部署者通过官方 Bundle/profile patch 固定 absolute paths 与 exact hash。插件在既有 Shadow/review
链内通过 native DSH Job 运行一次 Retention；没有 Commands/Remote/Web 路径参数，也没有独立
`dsh-evolve retain` executable。下文的 exit-code 语义保留为历史内部 runner 证据，当前 host-plane
结果以 native Job 状态和 durable Retention report 为准。

## Exact input gate

1. source run 必须有合法 `run-state.json`，phase/outcome 均为 `complete`；
2. terminal report 必须 exact 位于 source run，run id、Skill、baseline/Candidate hash 与 state 一致；
3. primary decision 只能是 `promote|review`，不能为 reject/incomplete；
4. durable proposal shape/hash 必须一致；
5. baseline Skill tree 与 primary Case Pack 仍匹配 source identity；
6. retention Case Pack 必须与 Skill/output/source run 相互分离，且开始/结束 hash 不变；
7. output 必须为新目录；不覆盖、不 resume、不自动重试。

## Evidence flow

```text
completed Shadow evidence
  ├─ exact baseline Skill
  ├─ exact persisted proposal
  └─ exact Candidate tree hash
                 |
                 v
trusted prior Case Pack
  calibration: known-bad fail + known-correction pass
  comparison:  prior baseline pass + exact Candidate ?
                 |
          retained / regressed / incomplete
```

Candidate 不读取 Case Pack/evaluator。既有 macOS sealed runner 复制 baseline/Candidate tree 后才执行
host evaluator；active tree 在 Trial 前后必须不变。

## Exit semantics

| 历史 runner exit | 结果 | 含义 |
|---:|---|---|
| `0` | `retained` | baseline 与 Candidate 都 pass，composition 稳定 |
| `3` | `regressed` | baseline pass、Candidate fail；适合 CI fail |
| `2` | `incomplete` | evaluator/输入/隔离/预算不足，不能判断 |
| `1` | error | 参数或不可信 source evidence |

`regressed` 是完整负证据，不伪装成运行错误；`incomplete` 绝不算 pass。

## Hard gates

- retain 发起的 proposer request count 固定为 0；
- primary run 与 private feedback/evaluator 内容不复制进 report，只保留 hash/id 与既有 bounded checks；
- Candidate tree hash 必须与 primary report 完全一致；
- primary/retention Pack 或 active Skill 任一漂移时 Trial/发布效果 fail closed；
- source run/report 不修改，正常 DSH Session Tool/Prompt/Skill/system composition 增量为 0；
- `SIGKILL` 后不自动执行任何 Trial；操作者只能选择新 output 明确重试；
- packed Bundle 与 Node 22/24 构建通过；tarball 不含 CLI。

## 成本边界

- 普通 DSH Session：`0` 个新增模型调用、`0` 个新增 Tool/Prompt/Skill/system surface；
- Retention proposer：固定 `0` 次；
- 一次完整 Retention：固定 `4` 次 sealed evaluator execution；
- assembled evaluator 可以在每棵树中调用它自己的 keyless 或真实模型 Adapter；可见的 comparison
  `modelCalls/usage` 进入报告。这是 Trial 成本，不得宣传成“零 token Retention”。

## 非目标

多 Pack suite、历史自动选择、Case 合并/淘汰、Web dashboard、自动 promotion、provider Judge、GEPA、
Skill Memory、Mission、第二个 journal daemon 与跨平台 sealed backend均不进入 P1.11。
