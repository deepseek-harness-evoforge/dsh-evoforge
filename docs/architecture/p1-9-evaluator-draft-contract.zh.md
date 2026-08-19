# P1.9 Evaluator Draft 契约

> 当前状态：**已撤销**。Evaluator Draft 运行时、控制面和测试已删除；本页仅保留历史记录，当前合同见 [ADR-0068](../adr/0068-shadow-consumes-one-exact-internal-candidate.md)。

> 状态：implemented；自动化实现门已通过，真实 provider/陌生用户效果证据仍待积累

## 用户结果

> 对已经给出明确纠正、但现有 Case Pack 未覆盖该失败的 DSH 用户，一次独立控制动作把 exact
> Feedback Signal 变成私有、可审查、不可执行的 Evaluator Draft，并立即返回；人工批准后只允许
> sealed calibration 资格验证，不能直接修改 Skill 或晋升能力。

该结果在 DSH 完全正确时仍有价值：DSH 提供反馈、Session、Jobs、隔离和模型执行，但不负责从一次
纠正起草独立的能力回归 evaluator。

## 产品 Interface

用户只学习一个现有 `/evolve feedback` 心智模型：

```text
/evolve feedback <signal-id> author <evaluator-target-id>
/evolve evaluator [<draft-id> [approve|reject <note>]]
```

Web 复用同一 Control Plane：Overview 显示 bounded Draft inbox；Author 前显示一次付费与最小私有
内容外发确认；Approve 前显示“将执行生成代码”的独立确认。原反馈 Session 永不等待这些动作。

内部深模块的测试 seam 冻结为一个 `EvaluatorDraftInbox`：

- `author(signalId, targetId)`：返回 durable Job receipt；
- `scan()`：返回 bounded status，不返回内容或 host path；
- `get(draftId)`：返回 exact bounded files、hash、cost 与 limitations；
- `approve(draftId, note)`：执行 sealed qualification，成功发布 Qualified Case Pack；
- `reject(draftId, note)`：durable terminal disposition。

Commands、Remote 与 Web 只委托这个 Interface；不各自实现状态或权限规则。

## 状态与恢复

```text
prepared
  → authoring-pending
  → draft-ready
  → qualification-running
  → qualified

任意校验失败 → incomplete
人工拒绝     → rejected
付费结果不确定 → uncertain
```

- `prepared` 说明尚无外部请求，可由同一显式动作继续。
- `authoring-pending` 在请求前 durable；崩溃或 transport ambiguity 后不得自动请求。
- `draft-ready` 的五个文件与 source draft/Skill/model identity 全部内容寻址。
- `qualification-running` 只有本地 sealed effect，可在重启后对 exact hash 重跑。
- `qualified` 以只读 content id 目录发布；不覆盖旧版本。
- run lock、atomic JSON 与 owner-root 规则复用 Shadow 的既有实现原则，不引入数据库队列。

## 固定文件与硬上限

唯一允许的输出路径：

```text
manifest.json
search/evidence.md
calibration/known-bad/SKILL.md
calibration/known-correction/SKILL.md
final-test/evaluator.mjs
```

- 恰好五个文件，不能重复；路径大小写固定；无绝对路径、反斜杠、`.`、`..` 或 symlink。
- 单文件最大 32 KiB，总计最大 64 KiB；模型输出 token 上限由 host 固定，不接受浏览器参数。
- host 生成 manifest，绑定静态 Target 的 pinned DSH revision，预算固定为 candidate=1、trial=4，并
  声明 exact evaluator 路径和两份 calibration tree；模型不能提供或覆盖 manifest。
- host 从 author 时复核的 exact active Skill tree 写入 known-bad；模型不能提供或覆盖 known-bad。
- 首片只接受 tree 中恰好一个 `SKILL.md` 的纯指令 Skill；多文件 Skill fail closed，待真实需求证明后
  再扩展固定文件契约，不能悄悄丢失辅助资源。
- 模型响应只允许 `searchEvidence`、`knownCorrectionSkill` 和 `evaluatorSource` 三个 bounded 字段；
  不能请求 network、secret、permission 或额外 executable。
- evaluator 仍是不可信代码；格式正确与 hash 稳定不等于允许执行。

## 权限与隐私

| 动作 | authority | 不授权 |
|---|---|---|
| Author | 本次 Command/Web 确认，或 P1.16 静态、默认关闭且带日预算的部署策略 | 执行生成代码、Shadow、Promotion |
| Approve | 独立人工 note + 原生/host 确认 | 修改 active Skill、把 qualification 当 clear win |
| Qualify-and-Shadow | P1.17 联合人工确认；qualification 成功才使用一次 P1.10 付费权限 | 自动审批、Promotion、qualification 失败时调用 proposer |
| Reject | 独立人工 note | 删除源 feedback 或 Session |
| 后续 Shadow | 继续沿用 P1.8 每次显式付费确认 | merge/release/deploy |

持久化可以包含 P1.4 已授权复制的 user text/correction、exact Skill body 和生成文件，但必须位于私有
root；Overview/日志不得返回这些内容。Detail 只向控制面返回有界生成文件，不返回原始 Session、
assistant answer、Tool output、cwd、模型 URL 或凭据。

## Cache 与验收 seam

Hard gates：

1. 原生配置与启用该能力时，真实 DSH 完整模型 request composition 逐字段相等；
2. Author/Approve/scan/detail 不改变 live Session 的 Tool/Prompt/Skill catalog；
3. transport timeout 或 `SIGKILL` at authoring-pending 后 provider request count 仍为 1；
4. 生成文件在人工批准前执行次数为 0；
5. approve 只对 exact unchanged hash，且 sealed known-bad fail / correction pass；
6. Browser 覆盖 disclosure → cancel（0 request）、author → refresh 后仍可见、approve 二次确认与失败反馈；
7. disable/remove 后 native DSH Session/Goal 可恢复，私有 Draft 可手工删除但不阻断启动；
8. 无真实 provider/陌生用户数据时只声明 `implemented`，不写“evaluator 已可信”或“better than Hermes”；P1.16 只自动生成 inactive Draft，P1.17 只组合人工权限，均不改变本门。

已实现证据见 [P1.9 验证记录](../evidence/p1-9-private-evaluator-draft.zh.md)。

## 非目标

通用 Test SDK、自动生成客观真理、模型 judge、自动批准 executable、动态 host path、自动 merge、
自动发布、默认后台付费、第二套 review 数据库、Mission、Workflow DAG 和多机调度均不进入 P1.9。
