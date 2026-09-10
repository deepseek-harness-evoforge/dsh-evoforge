# RP-1：内部 Skill 自进化 Provider 验收

## 当前边界

根目录 `benchmark:provider:rp1` 当前固定指向 epoch 2。这个 epoch 只保留两类可复核的无网络事实：

1. `manifest-interaction-current-epoch-2.json` 必须与已审阅内容逐字节一致；
2. 五条确定性、带 completed-turn qualification 的 model-declared Capability Gap fixture，在读取 Provider 配置前
   恰好形成一个内部 Skill Opportunity。

manifest 描述的是计划中的双 Provider authoring、Candidate-blind governance、Admission、assembled holdout 与
Retention 场景，不是这些步骤已经执行或通过的证据。fixture 也不是从 live AgentLoop、Routing receipt 或 routing
ledger 采集的事实，不能证明线上 Routing provenance。

当前 epoch 2 **没有经过 runtime attestation 的付费执行器**，因此不会进入 `ready`，不会调用 Provider，不会动态
加载 DSH build，不会读取或复用缓存结果，也不会写 `result.json`。只有补齐并重新审计可执行代码、运行时 artifact、
配置绑定、终态 revision 与私有输出边界后，才能在一个新 epoch 恢复付费路径；不能把当前 manifest 或确定性合同测试
冒充为真实 Provider 证据。

原 `manifest.json`、`contract.ts`、`execute.ts` 与 `run.ts` 是不可变的历史 epoch 1。根目录当前入口不调用它们的
执行路径，也不会把历史结果重新标记为 epoch 2 或当前 Interaction/Routing 合同的证据。

## 批准与退出码

未提供精确批准值时，入口只读取批准环境名并返回 `NOT_RUN`：

```text
DSH_EVOLVE_REAL_PROVIDER_APPROVED=I_APPROVE_PAID_REAL_PROVIDER_EVALUATION
```

下表中的退出码属于直接 epoch 2 runner 进程：

| 条件 | runner 退出码 | 报告 |
|---|---:|---|
| 未提供精确批准 | 2 | `status: not-run`，`paid-provider-execution-not-authorized` |
| 提供精确批准 | 1 | `status: failed`，`paid-provider-execution-blocked:runtime-attestation-incomplete` |

批准后的失败发生在读取任何 Provider secret、endpoint、model identity、DSH source path 或 run path 之前。当前入口
不需要、也不应注入这些值；它不存在退出码 0 或 `status: passed` 的路径。

## 命令

无付费合同门验证 manifest、fixture、批准前 `NOT_RUN`、批准后 hard block，以及两条 runner 输出：

```sh
pnpm benchmark:provider:rp1:check
```

当前 runner 可用于确认部署环境仍被安全阻断：

```sh
pnpm benchmark:provider:rp1
```

这个发布命令经过 `pnpm run` 和 `pnpm --filter ... exec` 两层生命周期包装；pnpm 会把 runner 的任意非零退出码
统一报告为命令失败 1。因此未批准时，JSON 仍是 `status: not-run` 且内部错误行保留 child exit 2，但顶层
`pnpm benchmark:provider:rp1` 的进程退出码是 1。自动化应同时读取 JSON `status` / `reasons`；不能把顶层 1
单独解释成已批准后的 hard block。

截至 2026-09-11，当前 epoch 2 只有上述确定性合同证据；没有发起外部模型请求，没有生成当前 epoch 的 paid
result，也没有 `passed` 结果。真实双 Provider 进化、长期负迁移/遗忘/误晋升与 Hermes paired 仍是发布阻断。
