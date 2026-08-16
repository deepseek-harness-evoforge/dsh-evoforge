# KV-1 长会话请求稳定性证据

> 状态：implemented evidence；证明 EvoForge 对正常 Session 的模型可见请求增量为零，不等同于真实 provider 的 cache-read 计费数据

## 用户结果

在一个已经运行 64 轮的原生 DSH Session 中，即使完整 `dsh-evolve` host plane 已配置，并在第 33 轮前
把新的 Capability Generation 设为 future-session active，当前 Session 交给 provider adapter 的
每一轮模型可见请求仍与完全未安装 EvoForge 的控制组一致。后台配置、Target、Case Pack、Candidate
和 active pointer 不进入 Prompt、Tool Schema、Skill catalog 或消息历史。

## 试验接缝

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；
- 接缝：真实 DSH Loader、Storage、Session、System Prompt、Tools、Skill、Agent 与 Agent Loop 最终调用
  `LlmAdapter.stream()` 的请求；
- 控制组：不安装 `dsh-evolve`；
- 实验组：安装 `dsh-evolve`，同时配置 supervisor、Shadow Target、Automatic Feedback Shadow、Evaluator
  Target、auto-promotion 和 exact Retention Target；
- 两组使用相同 persona、模型 route、64 条用户输入和固定模型响应；
- 比较前只删除 DSH 内部消息 id。该字段不会进入 provider 的模型可见内容，其余字段保持原始顺序并
  直接序列化比较。

## 可复核结果

```text
control provider requests:    64
evoforge provider requests:   64
serialized request delta:     none
tool list/order drift:         none
previous-request prefix loss: none
future Generation switch:     turn 33 前完成
current Session Generation:   native，未漂移
EvoForge target/path leakage: none
```

实验组的每个后续请求都完整保留上一请求的模型可见消息前缀，Tool 数组与第一轮一致。两组 64 个请求
逐项深比较和 JSON 序列化比较均相等；`evaluator`、Shadow Target id、Evaluator Target id 和 Retention
Target id 均未出现在请求中。

验证命令：

```bash
pnpm --filter dsh-evolve exec vitest run \
  test/generation-binder.e2e.test.ts \
  -t "keeps 64 native turns"
```

本机结果：`1 passed | 18 skipped`，用时约 `0.65s`。

第一次并行全仓检查还暴露了既有 evaluator `SIGKILL` 用例的测试轮询竞态：子进程尚未创建 launch
目录时，测试把 `0` 个目录误判成终态错误。修正仅让该测试把 pre-launch 视为“继续等待”，没有改变
产品恢复行为；之后并行 workspace test 和完整 `pnpm check` 均通过。

## 成本、权限与限制

- 正常 Agent provider 请求数增量：`0`；
- 正常 Session 模型可见 input 增量：`0`；
- 新 Tool、system section、Skill catalog 项：`0`；
- 外部写入、秘密读取和付费操作：`0`；
- 该试验使用固定无密钥 Adapter，因此不能给出真实 provider 的 `cache_read_tokens`、命中率、TTFT 或
  账单。它证明的是更前置的必要条件：EvoForge 没有改变 provider 将要缓存的模型可见请求；真实
  provider 的长会话 token/延迟 paired soak 仍待在明确预算授权后执行。
