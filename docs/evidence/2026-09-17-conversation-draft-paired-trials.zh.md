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

2026-09-17 已通过官方 CLI 将 `dsh-evolve` 与 `dsh-evolve-web` 更新到持久内容地址
`d6caa504c6fec695c04a29f8e211a53f200657c82cd1fc0829f2e86f8ababd15` 对应的 product pack。
只更新这两个包；保留旧 pack、配置备份、原生历史和凭据。默认关闭启动后，显式为原验收 Workspace 配置
24 次/UTC 日的试验策略并重启同一个 Host。端口检查确认只有一个进程监听 `127.0.0.1:3000`。

真实计划 `17171e9db4dbf9b7954a298a90cdb9ae6d1e5dfd73ba63dbf9df6272bc38c621` 已终止为
`uncertain / execution-failed`：第一个 baseline 分支为 running，后七个 pending，全部 dispatch marker 为零，
没有已保存的结果或用量。原生 sessions 目录未发现这八个试验身份的文件；尚不能证明具体初始化失败点。
24 个名额为保守预留，不是 24 次实际模型消耗。原始失败记录保留，没有删除计划、重跑或修改封存草稿与题目。

只读复核执行了官方 `--profile web --dump-config`（仅输出匹配的模块名称）、原生 Domain 的 phase/marker 投影、
sessions 文件名检查及 `lsof -nP -iTCP:3000 -sTCP:LISTEN`。有效配置包含原生 `tool-skill` 与 `agent-loop`。
另一个无密钥、无网络监听的最小运行时在缺少 `tool-skill` 时能复现初始化拒绝，但它与真实配置不一致，
不能据此认定线上根因。当前 catch 丢失具体异常，后续需用受限诊断取得真实初始化原因。

结论：部署已执行，真实对照未完成，改善、退步、可比性和实际成本均未测得。无密钥测试通过不能覆盖此次失败，
也不能替代真实效果、部署后冷恢复或完整 clean-profile 卸载验收。

### 初始化诊断与修复

随后在同一个真实 Host 临时加载了仅用于诊断的官方 Cordis 模块。它使用无业务内容的独立 Session identity，
在 beforeDispatch 强制拒绝，并另加精确 Session 的 LLM 发送拒绝；未读取封存测试题、未发出模型请求。
启动立即运行的诊断先发现工厂尚未注册；等待启动完成的诊断则得到
`tools.restrict() names unknown global tool "skill"`。直接检查新建 Agent 的工具视图只有 `report_capability_gap`，
没有 `skill`；有效配置中列出工具模块不代表程序化 Agent 自动继承了用户 preset。

修复只在缺失读取工具的试验 Agent 内挂载官方 Skill 插件；已有工具时复用其目录监听器，避免双重目录组成。
工具限制区分全局与局部注册，不改变普通会话权限。新增无全局 Skill 工具的回归测试修复前明确失败；
原生持久化八分支测试也改用与部署一致的无全局 Skill 配置。四文件 18 项测试、runtime surface 两项及类型检查通过。
这些 fixture 验证配置和生命周期，不证明草稿改善。

修复后的真实 Host 诊断到达 beforeDispatch，并按预设停止：`dispatchMarkers=0`、`requestCount=0`。
移除诊断配置后，`cmp` 确认 profile patch 与诊断前备份完全相同。保留诊断原生历史和私有诊断结果；
原失败计划仍为 uncertain，未重发、未替换草稿或治理材料。最初失败记录没有保存具体异常，因此不能反推它首先遇到
工厂时序还是工具缺失；这里证明的是可重复的工具配置缺陷及其修复，不是原始调用的完整异常追踪。

修复已打包到 product manifest hash `8a709c567c5354d8fa42f67997e4475ccd7aeec083c7e8e146e74392d9857bad`，
逐包 SHA-256 校验后移入持久内容地址；此次只通过官方 `plugin --profile web add <exact-tarball> --ignore-scripts`
更新 `dsh-evolve`，其余已安装包保持原版本。官方安装退出 0。`pnpm peers check` 仍报告 Host 提供的原生包未列在
独立 profile 的依赖树中；不能将该检查称为通过。实际 Host 加载与浏览器控制面恢复正常。
诊断验证使用修复后的本地编译模块；部署产物完成了构建/原生外置依赖检查和启动，但没有重跑真实封存实验。

部署后只有一个 Host 监听 `127.0.0.1:3000`。浏览器 reload 后仍是原会话 22 轮/47 步、原模型与权限，
对照区显示“实验未完成或结果不明，不自动重跑”、0/8 分支和零已记录请求，没有伪报成功。
逐字节检查诊断前备份的 22 个原生历史文件与七个原插件存储文件全部相同；profile patch 也相同。
试验 Domain 仍只有原失败计划且全部 marker 为零。完整效果对照、受控零调用恢复和 clean-profile 全生命周期验收仍未完成。
