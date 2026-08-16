# P1.10 Qualified Shadow Handoff 契约

> 状态：implemented；真实 provider、陌生用户可用性与多日 soak 尚未验证

## 唯一用户结果

> 用户审查并资格验证一个 Evaluator Draft 后，无需知道任何 host path，即可再确认一次付费与受限
> 纠正外发，把 exact Qualified Case Pack 交给既有 Feedback Shadow；原会话立即继续。

该能力只消除 P1.9 → P1.8 的手工路径死端，不增加 Mission、Workflow DAG、Memory、通用 Case
平台或新 daemon。

## Interface

```text
/evolve evaluator <64-char-qualified-draft-id> shadow
```

Web 在 qualified detail 中显示 `Start Qualified Shadow`；点击后必须出现区别于 qualification 的确认：
这一步会把 bounded correction 发送给配置模型并可能产生费用，但不会修改 Skill 或晋升。

内部只扩展两个深 Interface：

- `EvaluatorDraftInbox.startShadow(id)`：恢复并验证 host-only qualified input，再委托既有 launcher；
- `FeedbackShadowLauncher.launchExact(signalId, target)`：与静态 Target 进入同一个 private launch 实现。

Commands、Control Plane、Remote 与 Web 只委托，不计算 path/hash/identity。

## 配置

```yaml
supervisor:
  runRoots:
    - /private/evoforge/plugin-delivery-qualified-runs
evaluatorTargets:
  - id: plugin-delivery
    skill: build-dsh-plugin
    root: /private/evoforge/plugin-delivery-evaluators
    dshRevision: 47f943859bef60e4160492346772ded9b24f765a
    shadowRunRoot: /private/evoforge/plugin-delivery-qualified-runs
```

`shadowRunRoot` 可选，避免 P1.9 用户被迫启用付费 Shadow。声明后必须属于 supervisor exact roots，且
每个 Target 独占；最多仍为 20 个观察 Target。

## 状态所有权

```text
Evaluator journal: qualified (只读输入资格)
                         |
                         | explicit start + disclosure
                         v
Existing Shadow journal: prepared → proposal-pending → candidate-ready
                                  → trial-running → complete/incomplete
```

不向 Evaluator journal 复制 Shadow phase。Overview 的最近 runs 由扩展后的同一个
`FeedbackShadowLauncher.scan()` 从配置 run root 读取。重复动作复用 P1.8 launch id 与 journal。

## Hard gates

1. `draft-ready`、`incomplete`、`rejected`、`uncertain` 均不能启动；只接受 exact `qualified`。
2. qualified/draft 任一 hash 漂移时 provider request count 为 0。
3. Cancel 时 request count 为 0；Confirm 后原生 Job 立即返回，原 Session 不等待。
4. 相同动作并发/重启只产生一个 launch；`proposal-pending` 后 `SIGKILL` 不重复付费请求。
5. 使用生成的真实 Qualified Case Pack 完成 calibration → one proposer → paired Trial；不能直达
   Generation/Promotion。
6. Commands、Remote、Web 不出现 host path、反馈正文、Case Pack、模型地址或 secret。
7. 配置开关前后真实 DSH 正常 model request composition 完全相等，普通 Session token 增量 0。
8. 真实浏览器覆盖 qualified detail → Cancel → Confirm → visible scheduled/recent run 与失败反馈。
9. packed add/boot/remove 与 native fallback 继续通过。

## 非目标

自动启动、自动批准 evaluator、自动 merge/release/deploy、修改 active Skill、增加 evaluator judge、
多机队列、跨插件 workflow DSL、通用 run dashboard 与默认后台付费均不进入 P1.10。
