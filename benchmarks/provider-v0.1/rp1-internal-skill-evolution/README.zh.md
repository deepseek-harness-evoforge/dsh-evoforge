# RP-1：双真实 Provider 的内部 Skill 自进化验收

## 这条门证明什么

RP-1 是一个仓库级、阶段专用的验收入口，不是新插件、平台、Runtime、Session、Goal 或 evaluator 服务。
它把五条冻结的 DSH 内部 Capability Gap 事实送入现有生产模块，验证：

1. 五个不同 Goal 自主形成一个 Skill Opportunity；
2. proposer Provider 只基于密封的 authoring 证据生成完整 instruction-only Skill Candidate；
3. 另一套 governance Provider 分别从 Candidate 不可见的 admission、holdout、Retention 证据生成三套治理包；
4. Candidate 在准入前保持 `inactive/quarantined/unevaluated/never`；
5. 生产 Admission、assembled Shadow 和独立 Retention 依次通过，且 DSH composition 不漂移。

assembled Trial 继续使用现有 macOS Seatbelt 路径：子进程环境不继承 Provider 凭据，网络被拒绝。真实
Provider 只负责 Candidate 与 Candidate-blind evaluator 的生成；因此 RP-1 通过也只证明这一阶段，不等于
真实用户长期效果、Hermes paired benchmark 或整体上位替代完成。

## 付费与凭据边界

未提供下面的精确批准值时，入口在读取任何 Provider 配置或凭据前返回 `NOT_RUN`，退出码为 2：

```text
DSH_EVOLVE_REAL_PROVIDER_APPROVED=I_APPROVE_PAID_REAL_PROVIDER_EVALUATION
```

一次新执行最多发起 1 次 proposer authoring 和 3 次 governance authoring。批准代表允许本次外部付费
请求；它不允许发布、晋升、写 Git tag、发送消息或产生其他外部副作用。

运行时需要以下环境引用，凭据只允许通过进程环境提供，不能放入命令参数、仓库或报告：

| 角色 | 必需环境名 |
|---|---|
| proposer | `DSH_EVOLVE_MODEL_PROVIDER_ID`、`DSH_EVOLVE_MODEL_BASE_URL`、`DSH_EVOLVE_MODEL_NAME`、`DSH_EVOLVE_MODEL_API_KEY` |
| governance | `DSH_EVOLVE_GOVERNANCE_MODEL_PROVIDER_ID`、`DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL`、`DSH_EVOLVE_GOVERNANCE_MODEL_NAME`、`DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY` |
| 固定运行路径 | `DSH_EVOLVE_DSH_SOURCE_DIR`、`DSH_EVOLVE_REAL_PROVIDER_RUN_ROOT` |

两个角色必须使用不同 declared provider id、HTTPS authority、credential value 和生产 model identity，否则在
外部请求前失败。报告只保留 provider id、model、authority hash 和 model identity；base URL、API key 与
私有路径不会进入 stdout 或 `result.json`。不同 authority/model 的声明仍不能证明供应商后台绝对独立，最终
证据必须保留这一限制。

## 命令与退出码

先运行无付费合同门：

```sh
pnpm benchmark:provider:rp1:check
```

在部署者已经通过受保护方式注入全部环境引用、明确批准本次付费执行后运行：

```sh
pnpm benchmark:provider:rp1
```

| 退出码 | 含义 |
|---|---|
| 0 | 所有冻结 hard gate 通过，`status: passed` |
| 1 | 已授权执行失败或 hard gate 未通过，`status: failed` |
| 2 | 未授权或配置不完整，`status: not-run`；不是失败证据，也不是通过证据 |

入口要求 EvoForge 工作树干净、DSH checkout 正好位于 manifest 固定 revision、DSH `jobs-local` 已构建，
并把结果写入私有、内容寻址的 exact run。相同 epoch/revision/provider identity 的 terminal 结果不会自动重跑；
未知付费结果也不会通过普通 retry 被覆盖。

## 当前状态

截至 2026-08-24，合同、类型和 `NOT_RUN` 路径已通过；没有获得本次付费授权，且当前环境没有第二套
独立 Provider，因此没有执行外部模型请求，也没有 `passed` 结果。该事实必须在 README、需求、路线图、
状态和 V4.55 证据中保持一致。
