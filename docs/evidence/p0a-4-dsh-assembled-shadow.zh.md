# P0A.4：真实 DSH assembled Shadow 证据

> 历史接口提示：本页保留当时实际执行的 standalone CLI 证据；该产品入口已由 [ADR-0041](../adr/0041-dsh-is-the-only-runtime-and-install-surface.md) 撤销，命令不可作为当前使用说明。当前 assembled 产品入口是 DSH Bundle/profile 与 native Job。
>
> 状态：`implemented`；证明一条无密钥真实装配路径，不等于 P0A 已退出，也不证明真实模型已经改善

## 用户结果

当时的 standalone Shadow 能把 known-bad、known-correction、baseline 和 Candidate 四棵 Skill 树分别放进 macOS Sealed Trial，并通过固定 revision 的真实 DeepSeek Harness 完成：

```text
Cordis Loader
→ agent-spine-demo
→ skill-filesystem
→ tool-skill 的按需 instructions 注入
→ Agent Loop
→ 脚本 LLM Adapter
→ 真实 bash Tool 往返
→ Session 事件与 request/header
```

这条路径验证的是 evaluator 机械结构：Skill 确实到达模型历史，真实 Loader/Agent/Tool 都运行，且 Candidate 没有靠改变非目标组合面获胜。它不把固定脚本模型的结果冒充真实 provider 的能力提升。

## 固定输入

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
- Case Pack：[`examples/case-packs/browser-e2e-guidance-assembled`](../../examples/case-packs/browser-e2e-guidance-assembled)
- active Skill：[`examples/skills/browser-e2e-baseline`](../../examples/skills/browser-e2e-baseline)
- 外部 proposer：测试内无密钥固定 HTTP 响应；它是唯一被替换的外部模型边界
- Trial：macOS Seatbelt；无网络、无父进程秘密、workspace 可写；只读挂载固定 DSH checkout 的 `apps/`、`examples/`、`packages/`、`node_modules/` 与 vendored Cordis runtime，根目录秘密与 `.git` 不可读；只允许 Node 和 Bash executable

Host 在 Trial 前用 Git 校验 DSH checkout 的实际 `HEAD`。revision 不一致、环境变量缺失、装配 evaluator 不返回 composition 证据或任何边界无法建立时，命令返回 `2 + incomplete`。

## 可复跑命令

在相邻 DSH checkout 已安装依赖并完成 `build:lib:host` 后：

```bash
export DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness
pnpm --filter dsh-evolve exec vitest run \
  test/sealed-trial-darwin.e2e.test.ts \
  test/dsh-assembled-shadow.e2e.test.ts
```

2026-08-16 本机结果：

- 4 个 Sealed Trial 完成；
- known-bad=`fail`，known-correction=`pass`；
- baseline=`fail`，Candidate=`pass`；
- active Skill 不变；
- baseline/Candidate 每棵树各 2 次脚本模型调用；
- 每棵树的脚本计量均为 input `18`、output `8`、cache-read `2`、reasoning `1`；
- baseline 与 Candidate 的首个完整模型请求指纹相同：普通用户消息、Skill catalog、按需 Skill instructions、system prompt、Tool Schema 与模型配置都参与；计算时只把允许变化的 Skill body 替换为固定 token；
- Skill body 出现在按需 `skill-invocation` 消息中，不出现在 system prompt 或 Tool Schema 前缀中。

上述 token 是 DSH 固定 Adapter 的测试计量，只用于证明报告分类和配对相等，不能估算真实 provider 的绝对费用。

## KV Cache 结论

- 正常 DSH Session 仍未安装 EvoForge Provider、Tool、prompt section 或 catalog entry，增量为 `0`；
- 离线 Trial 内，Candidate 只改变按需 Skill body；system prompt、Tool Schema、模型配置、catalog、普通消息和工具往返均进入组合指纹；
- baseline/Candidate 的非目标组合指纹必须相同，否则 Decision 直接 `reject`。

## 尚不能声称

- 这份通用 bridge 本身不是产品 fixture；三个后续产品证据见 [P0A.5 cache-safe](p0a-5-cache-safe-status.zh.md)、[P0A.6 lifecycle](p0a-6-dispose-owned-watcher.zh.md) 与 [P0A.7 profile](p0a-7-profile-install-remove.zh.md)；
- 没有执行任意 Candidate 代码，Candidate 仍只是 Skill 数据；
- 公开 final-test 已参与开发，不能替代用户本机未见 final-test；
- 没有真实 provider 的 paired benchmark、统计复跑、磁盘配额、Linux/Windows executor；
- 不能声称已持续进化、可自动晋升或优于 Hermes。

此阶段结束时 P0A 仍为 `implemented / in progress`。后续产品 fixture 继续复用同一受限装配接缝；最终本地退出试验见 [P0A.8](p0a-8-private-heldout.zh.md)，Candidate 代码仍未越过已声明的执行边界。
