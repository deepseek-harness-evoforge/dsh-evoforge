# P1.13 Automatic Retention Target 契约

> 状态：implemented；首片只消除 clear-win 自动晋升前的手工 `retain` 步骤

## 唯一用户结果

> 部署者为一个 Workspace 内的 Skill 显式配置一个 exact prior Case Pack 后，原本满足 clear-win 的 Candidate 会在
> 后台自动完成旧能力检查；只有 `retained` 才能继续自动晋升，回归、失败或不确定执行都留在 review，
> 原始会话永不等待。

## 配置与授权

```yaml
autoPromote:
  targets:
    - workspaceId: <workspace-uuid>
      skill: build-dsh-plugin
  retentionRoots:
    - /absolute/path/to/.dsh/evoforge/retention-runs
  retentionTargets:
    - id: plugin-delivery-prior-v1
      workspaceId: <workspace-uuid>
      skill: build-dsh-plugin
      casePackDir: /absolute/path/to/prior-case-pack
      casePackHash: <64-char-sha256>
      runRoot: /absolute/path/to/.dsh/evoforge/retention-runs
```

- Target id 是 1–64 字符的稳定公开 id；路径只来自 host config；
- `casePackHash` 必须是 exact 64 字符内容 hash；运行时再次验证；
- `runRoot` 必须 exact 对应一个 `retentionRoots`；
- 每个 allowlisted Workspace + Skill 最多一个 Target，总 Target ≤ 20；
- 声明 Target 是部署者对该 exact evaluator 自动执行的明确策略授权。若 assembled evaluator 会调用
  模型，这可能为每个 exact Candidate 产生其报告所示费用；默认不配置即不自动执行。

## 决策顺序

```text
review Candidate
  └─ human/rejected/activated? ──> skip
  └─ P1.1 preflight clear-win? ──> no: review
  └─ P1.12 exact evidence
       retained/regressed/incomplete/warning ──> existing policy result
       missing
         └─ configured exact Retention Target
              └─ native evolution Job → P1.11 four sealed evaluator executions
                   retained   ──> existing P1.12 policy → future-Session promotion
                   regressed  ──> review
                   incomplete ──> review
                   uncertain  ──> no retry; human review
```

每个 supervisor scan 最多启动一个 Target，避免一次扫描产生无界费用。执行完成后复用同一轮的既有
P1.12 evidence index 和 P1.1 auto promoter；没有第二份 promotion 状态。

## Identity、崩溃与幂等

automatic output 目录名由 `Candidate id + Target id + exact Case Pack hash` 内容寻址。P1.11 继续验证
source Shadow、baseline/Candidate tree、Case Pack hash/epoch、calibration、Trial 和 unchanged facts。

P1.11 在 potentially effectful Trial 前创建 output。若进程在此后丢失且没有 terminal report，后续扫描
看到同一 output 后只给出有界 host warning，不自动重跑；这避免重复 evaluator/model 成本。若错误发生
在 output 创建前，说明 Trial 尚未开始，配置修正后允许重新验证。操作者在该窗口取消 native Job 时，
Candidate 在当前 DSH 进程内被抑制；重启后可重新评估。native Jobs 只负责当前进程观察与取消，
output/report 仍是跨重启事实。

## KV Cache 与成本

- normal Session 的完整 model request、Tool/Prompt/Skill 列表和排序不变；新增 token 为 `0`；
- scheduler/preflight/evidence scan 都是本地零模型操作；
- 每个自动 Retention 固定零 proposer、四次 evaluator execution；
- standalone evaluator 可以零模型；assembled evaluator 的调用和 usage 是显式 Target 授权下的独立成本；
- Candidate、Case Pack、host path 和 report 不写入 Prompt/Memory/Session history。

## 非目标

多个 Target 的 all/any/quorum、Case Registry、自动 Case 生成/升级/淘汰、跨主机队列、自动重试不确定
执行、通知中心、Web 路径管理、人工 promotion hard gate、Linux/Windows sealed backend 与生产多日
soak 均不进入 P1.13。
