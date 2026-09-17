# 普通聊天草稿的有限原生对照

## 真实调用前冻结的计划

对象是此前真实生成、尚未启用的 `wide-table-to-item-sections`，不是手工改写的 Skill 或操作者提供的测试包。
草稿内容 hash：`5d173a7b83a649fbdf7573b97e8db61edabd511cdce1bf3343d50fb43f115808`。
四项封存检查的 governance digest：`686b1b4a1f2d74f9983ac757e0228e3bc2e964c3276e941415f2bd228b8b5e1c`。
本次未向草稿作者提供测试输入、参考答案、负例或结果；不会看到输出后改题、改稿或重试挑选有利结果。

- 只在原授权验收 Workspace 中使用现有单一 DSH Host、原生 provider/model 和凭据。
- 四项自包含任务各有 baseline/draft 两个新建原生 Session；按题交替先后顺序，不新建 Host、Gateway 或 Codex 子智能体。
- 一次持久预留 24 个请求名额，每个分支最多三次、每次最多 2000 输出 token，90 秒后取消并等待原生资源释放。
- 原生工具只开放 Skill 读取；draft 分支只增加该草稿的 scoped catalog/body。模型自主决定是否调用官方 `skill`。
- 先确认 completed turn、无工具失败、四组完整首请求可比，再统计固定断言。改善分支未加载草稿不能归因于草稿。
- 同时保留通过、失败、相同结果、退步和不确定；不自动重跑、安装、启用、晋升或改写原会话。
- 记录原生日志、请求 digest、已知 token 和耗时；缺失 cache/usage/费用保持未知。测试 Session 历史保留以供审计。

这些是独立请求生成的有限检查，不是经人工确认的全部事实标准，也不是完整发布、泛化或 Hermes 对照结论。

## 实现与无密钥验证

DSH canonical fetch 仍为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` / `0.1.6-alpha.1`，检出干净。
`pnpm install --frozen-lockfile` 与完整 `pnpm run build` 成功，未修改上游。

内部原生执行模块接入 Workspace 策略、私有 native Domain、原生 Jobs 和只读控制面；契约见
[2.5 普通草稿的有限原生对照检查](../plugin-contract.zh.md#25-普通草稿的有限原生对照检查)。
`@deepseek-ai/dsh-llm` 作为 Host peer，不再打入插件 bundle。原生持久化测试曾发现跨模块 WeakSet 请求标记失配；
关联改为原生 Agent 请求信号、精确 Session id、原任务和已持久化 marker，并保留独立实例测试覆盖。

执行过的相关命令（`AUDITED_DSH_SOURCE` 表示本轮已审计 checkout，真实路径已脱敏）：

```sh
DSH_SOURCE_ROOT="$AUDITED_DSH_SOURCE" node scripts/generate-typert.mjs
pnpm --filter dsh-evolve run build
pnpm --filter dsh-evolve-web run build
DSH_EVOLVE_DSH_SOURCE_DIR="$AUDITED_DSH_SOURCE" pnpm --filter dsh-evolve exec vitest run test/config-contract.test.ts test/package-declarations-contract.test.ts test/conversation-correction-intake.test.ts test/conversation-correction-native.e2e.test.ts test/conversation-skill-draft.test.ts test/conversation-draft-trial-guard.test.ts test/conversation-draft-trial-store.test.ts
DSH_EVOLVE_DSH_SOURCE_DIR="$AUDITED_DSH_SOURCE" pnpm --filter dsh-evolve exec vitest run test/package-runtime-surface.test.ts test/evolution-control-plane.test.ts test/evolution-settled-event.e2e.test.ts
pnpm --filter dsh-evolve-web exec vitest run
pnpm --filter dsh-evolve exec tsc --noEmit -p tsconfig.test.json
pnpm --filter dsh-evolve-web exec tsc --noEmit -p tsconfig.test.json
pnpm run check:docs
git diff --check
```

当前通过：Host 相关两组 60/15 项、Web 40 项、构建及类型检查。原生 JSON Storage/Session persistence/Jobs 测试
执行全部八个分支、加载官方 Skill、冷重启读取相同记录且不重复调用，原会话逐事件不变；此处模型仍是无密钥 fixture。
fixture 中两边均通过四项，明确记录为 `no-improvement`，没有把 equal outcome 改判为学习成功。

## 部署与真实结果

本节在实际部署和请求结束后补充。在此之前，只有计划和无密钥证据，不能称真实效果已经验证。
